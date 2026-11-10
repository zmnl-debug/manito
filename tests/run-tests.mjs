#!/usr/bin/env node
/**
 * 마니또 뽑기 테스트 — index.html의 <script>를 그대로 불러와 검증한다.
 * 요구 사항: Node 18 이상 (globalThis.crypto.subtle 내장)
 * 실행: node tests/run-tests.mjs
 *
 * document가 없는 Node 환경이므로 스크립트 안의 UI 코드는 자동으로 건너뛰어지고,
 * DOM 없이 동작하는 코어 함수(매칭·인코딩·암호화·D-day)만 검증한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Node 18의 일부 초기 버전에서 globalThis.crypto가 기본 노출되지 않을 수 있어 폴백을 둔다
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('index.html에서 <script> 블록을 찾을 수 없어요.');
  process.exit(1);
}
const Core = new Function(scriptMatch[1] + '\n;return ManitoCore;')();

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; failures.push(label); console.log('  FAIL  ' + label); }
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

function isoDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function dateAfter(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/* ------------------------------------------------------------------ */
/* 테스트 1. 매칭 1,000회 검증 (3명, 5명, 10명)                          */
/* ------------------------------------------------------------------ */
section('테스트 1. 매칭 1,000회 x 3가지 인원 — 자기 배정/중복 배정 0건');
{
  const sizes = {
    '3명': ['김철수', '이영희', '박민수'],
    '5명': ['김철수', '이영희', '박민수', '최지우', '정하늘'],
    '10명': ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'],
  };
  let selfCount = 0;
  let dupCount = 0;
  let invalidCount = 0;
  let runs = 0;
  for (const names of Object.values(sizes)) {
    for (let i = 0; i < 1000; i++) {
      runs++;
      const pairs = Core.assignManitos(names);
      const persons = pairs.map(p => p.person);
      const manitos = pairs.map(p => p.manito);
      if (persons.some((n, idx) => n === manitos[idx])) selfCount++;
      if (new Set(manitos).size !== manitos.length) dupCount++;
      if (manitos.some(m => !names.includes(m)) || new Set(persons).size !== persons.length) invalidCount++;
    }
  }
  check(`총 ${runs}회 실행됨 (3/5/10명 x 1,000회)`, runs === 3000);
  check(`자기 자신 배정 0건 (발견: ${selfCount}건)`, selfCount === 0);
  check(`중복 배정 0건 (발견: ${dupCount}건)`, dupCount === 0);
  check(`모든 배정이 유효한 참가자 이름`, invalidCount === 0);
}

/* ------------------------------------------------------------------ */
/* 테스트 2. 등록 → 매칭 → 확인 전 과정 시뮬레이션 (4명)                  */
/* ------------------------------------------------------------------ */
section('테스트 2. 등록 - 매칭 - 확인 전 과정 시뮬레이션 (4명)');
{
  const room = Core.createRoom('우리 반 연말 파티', dateAfter(14), '1만원 이하');
  const people = [
    { name: '김철수', pin: '123456' },
    { name: '이영희', pin: '240815' },
    { name: '박민수', pin: '903171' },
    { name: '최지우', pin: '555000' },
  ];

  // (1) 참가 등록: 각자 브라우저에서 등록 코드 생성
  const codes = [];
  for (const person of people) {
    const { code } = await Core.createRegistrationCode(room, person.name, person.pin);
    codes.push(code);
  }
  check('등록 코드 4개가 MANITO1- 접두어로 생성됨', codes.every(c => c.startsWith('MANITO1-')));

  // (2) 방장: 받은 코드 검증
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id);
  check('방장이 받은 4개 코드가 모두 수락됨',
    parsed.entries.length === 4 && parsed.rejected.length === 0);
  check('등록 인원 이름 목록이 정확함',
    JSON.stringify(parsed.entries.map(e => e.n).sort()) ===
    JSON.stringify(people.map(p => p.name).sort()));

  // (3) 방장: 매칭 후 개인 링크 생성
  const links = await Core.createPersonalLinks(room, parsed.entries);
  check('개인 링크 4개 생성됨', links.length === 4);
  check('모든 개인 링크가 #m= 해시 형식임', links.every(l => l.url.startsWith('#m=')));
  const persons = links.map(l => l.n);
  const manitos = links.map(l => l.manito);
  check('자기 자신 배정 0건', persons.every((n, i) => n !== manitos[i]));
  check('중복 배정 0건', new Set(manitos).size === 4);

  // (4) 참가자: 개인 링크를 열고 PIN으로 자기 마니또 확인
  let allMatched = true;
  for (const link of links) {
    const payloadStr = link.url.slice(3);
    const payload = Core.parsePersonalLinkPayload(payloadStr);
    const revealed = await Core.openPersonalLink(payload, people.find(p => p.name === link.n).pin);
    if (revealed !== link.manito) allMatched = false;
  }
  check('4명 모두 PIN으로 자기 마니또 이름을 정확히 복호화함', allMatched);
}

/* ------------------------------------------------------------------ */
/* 테스트 3. 틀린 PIN으로는 복호화되지 않음                              */
/* ------------------------------------------------------------------ */
section('테스트 3. 틀린 PIN 복호화 차단');
{
  const room = Core.createRoom('틀린 PIN 방', dateAfter(7), '');
  const pins = { '김철수': '314159', '이영희': '222222', '박민수': '333333' };
  const codes = [];
  for (const [name, pin] of Object.entries(pins)) {
    codes.push((await Core.createRegistrationCode(room, name, pin)).code);
  }
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id);
  const links = await Core.createPersonalLinks(room, parsed.entries);
  const target = links.find(l => l.n === '김철수');
  const wrongPins = ['000000', '999999', '314160', '031415'];
  let blocked = true;
  for (const wrong of wrongPins) {
    try {
      await Core.openPersonalLink(target.url.slice(3), wrong);
      blocked = false; // 틀린 PIN인데 열렸다면 실패
    } catch (e) {
      if (e.code !== 'WRONG_PIN') blocked = false;
    }
  }
  check('틀린 PIN 4종으로는 전부 복호화 실패 (WRONG_PIN)', blocked);
  const correct = await Core.openPersonalLink(target.url.slice(3), '314159');
  check('올바른 PIN으로는 정상 복호화됨', correct === target.manito);
}

/* ------------------------------------------------------------------ */
/* 테스트 4. 다른 방 코드 필터                                           */
/* ------------------------------------------------------------------ */
section('테스트 4. 다른 방의 등록 코드 필터링');
{
  const roomA = Core.createRoom('A반', dateAfter(7), '');
  const roomB = Core.createRoom('B반', dateAfter(7), '');
  const codeA = (await Core.createRegistrationCode(roomA, '김철수', '111111')).code;
  const codeB1 = (await Core.createRegistrationCode(roomB, '이영희', '222222')).code;
  const codeB2 = (await Core.createRegistrationCode(roomB, '박민수', '333333')).code;
  const garbage = 'MANITO1-!!!!깨진코드!!!!';
  const notCode = '안녕하세요이건코드가아니에요';

  const result = Core.parseRegistrationCodes(
    [codeA, codeB1, codeB2, garbage, notCode].join('\n'), roomA.id);

  check('같은 방(A반) 코드 1개만 수락됨', result.entries.length === 1 && result.entries[0].n === '김철수');
  const reasons = result.rejected.map(r => r.reason).sort().join(',');
  check('거절 사유 구분 정확 (OTHER_ROOM x2, BROKEN, FORMAT)',
    reasons === 'BROKEN,FORMAT,OTHER_ROOM,OTHER_ROOM');
  const otherRoomNames = result.rejected.filter(r => r.reason === 'OTHER_ROOM').map(r => r.name);
  check('다른 방 코드의 이름 정보 표시 (이영희, 박민수)',
    otherRoomNames.includes('이영희') && otherRoomNames.includes('박민수'));
}

/* ------------------------------------------------------------------ */
/* 테스트 5. 예산 유무에 따른 페이로드 필드                               */
/* ------------------------------------------------------------------ */
section('테스트 5. 예산 입력 방 / 미입력 방 표시·숨김 데이터 확인');
{
  const withBudget = Core.createRoom('예산 있는 방', dateAfter(7), '1만원 이하');
  const withoutBudget = Core.createRoom('예산 없는 방', dateAfter(7), '');

  check('예산 입력 방: 방 페이로드에 예산(b) 포함', withBudget.b === '1만원 이하');
  check('예산 미입력 방: 방 페이로드에 예산 필드 자체가 없음', !('b' in withoutBudget));

  // 개인 링크에도 같은 규칙이 적용되는지 확인 (3명 매칭)
  const mkLinks = async (room) => {
    const codes = [];
    for (const n of ['가', '나', '다']) {
      codes.push((await Core.createRegistrationCode(room, n, '123456')).code);
    }
    const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id).entries;
    return Core.createPersonalLinks(room, entries);
  };
  const linkB = await mkLinks(withBudget);
  const linkN = await mkLinks(withoutBudget);
  const payB = Core.parsePersonalLinkPayload(linkB[0].url.slice(3));
  const payN = Core.parsePersonalLinkPayload(linkN[0].url.slice(3));
  check('예산 입력 방: 개인 링크에 예산 포함', payB.b === '1만원 이하');
  check('예산 미입력 방: 개인 링크에 예산 필드가 없음', !('b' in payN));
}

/* ------------------------------------------------------------------ */
/* 테스트 6. D-day 계산 (오늘 / 내일 / 어제 / 선행 0 없음)                */
/* ------------------------------------------------------------------ */
section('테스트 6. D-day 계산');
{
  // 보는 사람 기기의 현지 날짜 기준 — 고정된 "오늘"로 계산을 검증
  const today = new Date(2026, 10, 10, 23, 59, 30); // 2026-11-10 (시각은 무시되어야 함)
  const ref = isoDate(today);
  check('공개일이 오늘이면 D-DAY', Core.calcDday(ref, today) === 'D-DAY');
  check('공개일이 내일이면 D-1', Core.calcDday(dateAfter(1), today) === 'D-1');
  check('공개일이 어제면 D+1', Core.calcDday(dateAfter(-1), today) === 'D+1');
  check('12일 뒤면 선행 0 없이 D-12', Core.calcDday(dateAfter(12), today) === 'D-12');
  check('2일 전이면 D+2', Core.calcDday(dateAfter(-2), today) === 'D+2');
  check('now 미지정 시 실제 오늘 기준으로 계산됨', Core.calcDday(ref) === 'D-DAY');
  check('잘못된 날짜는 null', Core.calcDday('2026-13-40', today) === null);
}

/* ------------------------------------------------------------------ */
/* 테스트 7. 한글 / 공백 / 이모지 이름                                   */
/* ------------------------------------------------------------------ */
section('테스트 7. 한글, 공백 포함, 이모지 이름 처리');
{
  const room = Core.createRoom('특수 이름 방', dateAfter(7), '');
  const people = [
    { name: '김철수', pin: '111111' },
    { name: '홍 길동', pin: '222222' },
    { name: '이👀수', pin: '333333' },
    { name: '박✨ 하늘 별', pin: '444444' },
  ];
  const codes = [];
  for (const p of people) {
    codes.push((await Core.createRegistrationCode(room, p.name, p.pin)).code);
  }
  check('한글/공백/이모지 이름으로 등록 코드 생성 성공',
    codes.every(c => c.startsWith('MANITO1-')));

  // base64url 알파벳만 사용하는지 (URL 해시 안전성)
  const b64url = /^[A-Za-z0-9_-]+$/;
  check('모든 페이로드가 URL 안전한 base64url 문자만 사용',
    codes.every(c => b64url.test(c.slice('MANITO1-'.length))));

  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id).entries;
  check('붙여넣기(줄바꿈 구분) 후 4명 모두 수락됨', entries.length === 4);
  const links = await Core.createPersonalLinks(room, entries);
  let allOk = true;
  for (const link of links) {
    const payload = Core.parsePersonalLinkPayload(link.url.slice(3));
    const revealed = await Core.openPersonalLink(payload, people.find(p => p.name === link.n).pin);
    if (revealed !== link.manito) allOk = false;
  }
  check('특수 이름 4명 모두 매칭 후 PIN 복호화까지 정확히 일치', allOk);
}

/* ------------------------------------------------------------------ */
/* 테스트 8. 완전히 같은 등록 코드 중복 붙여넣기                          */
/* ------------------------------------------------------------------ */
section('테스트 8. 같은 등록 코드 중복 붙여넣기 처리');
{
  const room = Core.createRoom('중복 코드 방', dateAfter(7), '');
  const codes = [];
  for (const [name, pin] of [
    ['김철수', '111111'], ['이영희', '222222'], ['박민수', '333333'], ['최지우', '444444'],
  ]) {
    codes.push((await Core.createRegistrationCode(room, name, pin)).code);
  }

  // 같은 코드(문자열이 완전히 같음)를 두 번 포함해 붙여넣는 경우
  const pasted = [codes[0], codes[0], codes[1], codes[2], codes[3]].join('\n');
  const parsed = Core.parseRegistrationCodes(pasted, room.id);
  check('완전히 같은 코드는 하나만 수락됨 (4명 수락, 김철수 1명)',
    parsed.entries.length === 4 &&
    parsed.entries.filter(e => e.n === '김철수').length === 1);
  const dupRejected = parsed.rejected.filter(r => r.reason === 'DUPLICATE_CODE');
  check('중복 코드는 조용히 제외되지 않고 DUPLICATE_CODE로 rejected에 표시됨',
    dupRejected.length === 1);
  check('DUPLICATE_CODE 표시에 코드 스니펫이 포함됨', !!dupRejected[0].snippet);

  // 중복 제거 후 정상적으로 매칭까지 진행되는지
  const links = await Core.createPersonalLinks(room, parsed.entries);
  check('중복 코드가 제거된 4명으로 매칭 정상 진행', links.length === 4);

  // 이름만 같고 코드가 다른 경우는 지금처럼 매칭을 막는다
  const otherCodeSameName = (await Core.createRegistrationCode(room, '김철수', '999999')).code;
  const parsed2 = Core.parseRegistrationCodes(
    [codes[0], otherCodeSameName, codes[1], codes[2]].join('\n'), room.id);
  check('이름만 같고 코드가 다른 경우는 여전히 중복 이름으로 감지됨',
    parsed2.entries.length === 4 && parsed2.duplicates.includes('김철수'));
  let blockedByDupName = false;
  try { await Core.createPersonalLinks(room, parsed2.entries); }
  catch (e) { blockedByDupName = e.code === 'DUPLICATE_NAME'; }
  check('이름이 중복되면 매칭이 차단됨 (DUPLICATE_NAME)', blockedByDupName);
}

/* ------------------------------------------------------------------ */
/* 추가 검증: PIN 규칙 / 깨진 링크 / 최소 인원                            */
/* ------------------------------------------------------------------ */
section('추가 검증. PIN 규칙, 깨진 링크, 최소 인원');
{
  check('PIN 5자리는 거부', (() => { try { Core.validatePin('12345'); return false; } catch { return true; } })());
  check('PIN 6자리는 통과', Core.validatePin('123456') === '123456');
  check('PIN에 문자가 섞이면 거부', (() => { try { Core.validatePin('12a456'); return false; } catch { return true; } })());
  check('공개일 미입력은 방 생성 차단',
    (() => { try { Core.createRoom('방', '', ''); return false; } catch (e) { return e.code === 'NO_DATE'; } })());
  check('과거 공개일은 방 생성 차단',
    (() => { try { Core.createRoom('방', dateAfter(-3), ''); return false; } catch (e) { return e.code === 'PAST_DATE'; } })());
  check('깨진 페이로드는 해석 실패', (() => { try { Core.decodePayload('!!!깨짐!!!'); return false; } catch { return true; } })());
  // 2명은 매칭 구조상 가능하지만, 개인 링크 생성은 최소 3명으로 강제한다
  const room2 = { v: 1, id: 'testroom', g: '2명 방', d: dateAfter(7) };
  const two = [];
  for (const n of ['가', '나']) {
    two.push((await Core.createRegistrationCode(room2, n, '123456')).entry);
  }
  let tooFew2 = false;
  try { await Core.createPersonalLinks(room2, two); } catch (e) { tooFew2 = e.code === 'TOO_FEW'; }
  check('2명 매칭은 최소 인원 미달로 차단', tooFew2);
  const room = Core.createRoom('최소 인원 방', dateAfter(7), '');
  const one = (await Core.createRegistrationCode(room, '가', '123456')).code;
  const entries = Core.parseRegistrationCodes(one, room.id).entries;
  let tooFew = false;
  try { await Core.createPersonalLinks(room, entries); } catch (e) { tooFew = e.code === 'TOO_FEW'; }
  check('1명으로는 매칭 차단 (최소 3명)', tooFew);
}

/* ------------------------------------------------------------------ */
/* 결과 요약                                                            */
/* ------------------------------------------------------------------ */
console.log('\n========================================');
console.log(`결과: ${passed}개 통과, ${failed}개 실패 (총 ${passed + failed}개)`);
if (failed > 0) {
  console.log('실패한 항목:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('모든 테스트를 통과했어요.');
}
