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
    const { code } = await Core.createRegistrationCode(room, person.name, person.pin, 2);
    codes.push(code);
  }
  check('등록 코드 4개가 MANITO2- 접두어로 생성됨', codes.every(c => c.startsWith('MANITO2-')));

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
    codes.push((await Core.createRegistrationCode(room, name, pin, 2)).code);
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
      codes.push((await Core.createRegistrationCode(room, n, '123456', 2)).code);
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
  // dateAfter는 실제 오늘 기준이라 방 생성용이고, D-day 검증은 고정 기준일 대비 상대 날짜를 쓴다
  const rel = (days) => {
    const d = new Date(2026, 10, 10);
    d.setDate(d.getDate() + days);
    return isoDate(d);
  };
  check('공개일이 오늘이면 D-DAY', Core.calcDday(ref, today) === 'D-DAY');
  check('공개일이 내일이면 D-1', Core.calcDday(rel(1), today) === 'D-1');
  check('공개일이 어제면 D+1', Core.calcDday(rel(-1), today) === 'D+1');
  check('12일 뒤면 선행 0 없이 D-12', Core.calcDday(rel(12), today) === 'D-12');
  check('2일 전이면 D+2', Core.calcDday(rel(-2), today) === 'D+2');
  check('now 미지정 시 실제 오늘 기준으로 계산됨', Core.calcDday(isoDate(new Date())) === 'D-DAY');
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
    codes.push((await Core.createRegistrationCode(room, p.name, p.pin, 2)).code);
  }
  check('한글/공백/이모지 이름으로 등록 코드 생성 성공',
    codes.every(c => c.startsWith('MANITO2-')));

  // base64url 알파벳만 사용하는지 (URL 해시 안전성)
  const b64url = /^[A-Za-z0-9_-]+$/;
  check('모든 페이로드가 URL 안전한 base64url 문자만 사용',
    codes.every(c => b64url.test(c.slice('MANITO2-'.length))));

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
    codes.push((await Core.createRegistrationCode(room, name, pin, 2)).code);
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
  const otherCodeSameName = (await Core.createRegistrationCode(room, '김철수', '999999', 2)).code;
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
    two.push((await Core.createRegistrationCode(room2, n, '123456', 2)).entry);
  }
  let tooFew2 = false;
  try { await Core.createPersonalLinks(room2, two); } catch (e) { tooFew2 = e.code === 'TOO_FEW'; }
  check('2명 매칭은 최소 인원 미달로 차단', tooFew2);
  const room = Core.createRoom('최소 인원 방', dateAfter(7), '');
  const one = (await Core.createRegistrationCode(room, '가', '123456', 2)).code;
  const entries = Core.parseRegistrationCodes(one, room.id).entries;
  let tooFew = false;
  try { await Core.createPersonalLinks(room, entries); } catch (e) { tooFew = e.code === 'TOO_FEW'; }
  check('1명으로는 매칭 차단 (최소 3명)', tooFew);
}

/* ------------------------------------------------------------------ */
/* 테스트 9. v2 전 과정 시뮬레이션 (등록 - 매칭 - 확인)                    */
/* ------------------------------------------------------------------ */
section('테스트 9. v2 전 과정 시뮬레이션 (4명)');
{
  const room = Core.createRoom('v2 방 ✨', dateAfter(14), '1만원 이하');
  const people = [
    { name: '김철수', pin: '123456' },
    { name: '홍 길동', pin: '240815' },
    { name: '이👀수', pin: '903171' },
    { name: '박✨하늘', pin: '555000' },
  ];
  const codes = [];
  for (const person of people) {
    codes.push((await Core.createRegistrationCode(room, person.name, person.pin, 2)).code);
  }
  check('v2: 등록 코드 4개가 MANITO2- 접두어로 생성됨', codes.every(c => c.startsWith('MANITO2-')));
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id);
  check('v2: 4개 코드 모두 수락됨', parsed.entries.length === 4 && parsed.rejected.length === 0);
  const links = await Core.createPersonalLinks(room, parsed.entries);
  check('v2: 개인 링크 4개 생성, 해시 첫 바이트가 모두 0x02',
    links.length === 4 && links.every(l => {
      const b = Core.b64urlToBytes(l.url.slice(3));
      return b.length > 0 && b[0] === 0x02;
    }));
  const pay = Core.parsePersonalLinkPayload(links[0].url.slice(3));
  check('v2: 파싱 결과 버전·방 정보·예산 유지',
    pay.v === 2 && pay.g === room.g && pay.d === room.d && pay.b === '1만원 이하');
  let allOk = true;
  for (const link of links) {
    const revealed = await Core.openPersonalLink(link.url.slice(3),
      people.find(p => p.name === link.n).pin);
    if (revealed !== link.manito) allOk = false;
  }
  check('v2: 4명 모두 비밀번호로 자기 마니또를 정확히 복호화함', allOk);
  let blocked = true;
  try {
    await Core.openPersonalLink(links[0].url.slice(3), '000000');
    blocked = false;
  } catch (e) {
    if (e.code !== 'WRONG_PIN') blocked = false;
  }
  check('v2: 틀린 비밀번호는 복호화 차단 (WRONG_PIN)', blocked);
  const otherRoom = Core.createRoom('다른 v2 방', dateAfter(7), '');
  const otherCode = (await Core.createRegistrationCode(otherRoom, '외부인', '777777', 2)).code;
  const mixed = Core.parseRegistrationCodes([codes[0], otherCode].join('\n'), room.id);
  check('v2: 다른 방 코드는 OTHER_ROOM으로 제외됨',
    mixed.entries.length === 1 &&
    mixed.rejected.length === 1 && mixed.rejected[0].reason === 'OTHER_ROOM' &&
    mixed.rejected[0].name === '외부인');
}

/* ------------------------------------------------------------------ */
/* 테스트 10. v2 링크·코드 길이                                          */
/* ------------------------------------------------------------------ */
section('테스트 10. v2 링크·코드 길이');
{
  const room = Core.createRoom('26년 왕가네 마니또', dateAfter(30), '1만원 이하');
  const people = ['김철수', '이영희', '박민수', '최지우']; // 3글자 한글 기준
  const roomHash = Core.roomLink(room).slice(3);
  const codes = [];
  for (const n of people) {
    codes.push((await Core.createRegistrationCode(room, n, '123456', 2)).code);
  }
  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id).entries;
  const links = await Core.createPersonalLinks(room, entries);
  console.log(`  길이 — 방 링크 해시: ${roomHash.length}자, 등록 코드: ${codes[0].length}자, 개인 링크 해시: ${links[0].url.slice(3).length}자`);
  check('v2: 등록 코드 260자 미만', codes.every(c => c.length < 260));
  check('v2: 개인 링크 해시 500자 미만', links.every(l => l.url.slice(3).length < 500));
}

/* ------------------------------------------------------------------ */
/* 테스트 11. v1 하위 호환 (기존 링크·코드 그대로 동작)                    */
/* ------------------------------------------------------------------ */
section('테스트 11. v1 하위 호환');
{
  // 실제 서비스 중인 v1 개인 링크 해시 (비밀번호를 모르므로 파싱까지만 검증)
  const v1Hash = 'eyJ2IjoxLCJyIjoiZlBhTWVudFYiLCJnIjoiMjbrhYQg7JmV6rCA64SkIOuniOuLiOuYkCIsImQiOiIyMDI2LTEyLTI1IiwibiI6IuydtOuLpOyduCIsImVrIjoieEQ5dnpMYXhCbDhMZlk1ZFVUNjM0NU45b0wwZG40Rk1Qc0lmdmlac0tDZDhwSWpfQnFMdEdsQ3ZJYTRaRXRjWHNGd1FfZnNKaHBSTjVXNjJzcXJ2TEx6Qjg4SXFONldOazNpRFlleVpxWVJIRVNwVkxNdno4NUJmakVPamhHT19rV2ZIemxYWk90REJGalg3TGxYV245YTZzZVk4RGNRcjlQdHhxSjVRTlRNQXZmTlljR2RhT29LOF9TN2cwQ1VQcTQyQWVDLXc2WU5PaS12UlRaaVp1dGpqYmhCT1FsZ3c5Tmt5cjdBTVZNeDVtRHFQOTd6VlNJOURDTU9KU1NqYSIsInMiOiJZLTdQbUlVSFJkcUJPUHg0TUE0d3VRIiwiaSI6InB5a0ZVcE01SEtiam1kaUoiLCJvayI6eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Im5mN3pJem1SNmJkb2dWUkFHM29wZUpJdUdWMEdxZVhGVnBhci1iZjNxSzQiLCJ5IjoiUEx5VlktUVItdVVub0s5QS1xdmNOaF85OEstRDVxd0k0ei1TUndxYTI3WSJ9LCJjIjoiN3VaS2trb09fSTNZMkpYdHZxbTAyOHFEalRoSE5weFQzQSIsInciOiJMRlkydmxMWmJrX1JVeVdKIn0';
  const p = Core.parsePersonalLinkPayload(v1Hash);
  check('v1 개인 링크 파싱: 그룹 이름 유지', p.g === '26년 왕가네 마니또');
  check('v1 개인 링크 파싱: 받는사람 이름 유지', p.n === '이다인');
  check('v1 개인 링크 파싱: 공개일 유지 (2026-12-25)', p.d === '2026-12-25');

  // v1 방 링크도 그대로 파싱되고, 그 방에서 v1 전 과정이 계속 동작한다
  const v1Room = Core.parseRoomPayload(Core.roomLink(
    { v: 1, id: 'fPaMentV', g: '26년 왕가네 마니또', d: '2026-12-25', b: '1만원 이하' }).slice(3));
  check('v1 방 링크 파싱 유지',
    v1Room.v === 1 && v1Room.id === 'fPaMentV' && v1Room.d === '2026-12-25' && v1Room.b === '1만원 이하');
  const pins1 = { '김철수': '111111', '이영희': '222222', '박민수': '333333' };
  const codes1 = [];
  for (const [name, pin] of Object.entries(pins1)) {
    codes1.push((await Core.createRegistrationCode(v1Room, name, pin, 1)).code);
  }
  check('v1 등록 코드 생성 유지 (MANITO1-)', codes1.every(c => c.startsWith('MANITO1-')));
  const entries1 = Core.parseRegistrationCodes(codes1.join('\n'), v1Room.id).entries;
  check('v1 등록 코드 3개 수락', entries1.length === 3 && entries1.every(e => e.v === 1));
  const links1 = await Core.createPersonalLinks(v1Room, entries1);
  check('v1 코드의 개인 링크는 v1 형식 유지',
    links1.every(l => Core.parsePersonalLinkPayload(l.url.slice(3)).v === 1));
  let v1Ok = true;
  for (const link of links1) {
    const revealed = await Core.openPersonalLink(link.url.slice(3), pins1[link.n]);
    if (revealed !== link.manito) v1Ok = false;
  }
  check('v1 전 과정(등록-매칭-복호화) 그대로 동작', v1Ok);
  const v3FromV1Room = (await Core.createRegistrationCode(v1Room, '최지우', '444444')).code;
  check('v1 방 링크로 등록해도 새 코드는 v3', v3FromV1Room.startsWith('MANITO3-'));
}

/* ------------------------------------------------------------------ */
/* 테스트 12. v1/v2 혼합 매칭                                            */
/* ------------------------------------------------------------------ */
section('테스트 12. v1/v2 혼합 매칭');
{
  const room = Core.createRoom('혼합 방', dateAfter(7), '');
  const pins = { '김철수': '111111', '이영희': '222222', '박민수': '333333', '최지우': '444444' };
  const codes = [
    (await Core.createRegistrationCode(room, '김철수', pins['김철수'], 1)).code,
    (await Core.createRegistrationCode(room, '이영희', pins['이영희'], 1)).code,
    (await Core.createRegistrationCode(room, '박민수', pins['박민수'], 2)).code,
    (await Core.createRegistrationCode(room, '최지우', pins['최지우'], 2)).code,
  ];
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id);
  check('혼합: v1 코드 2개 + v2 코드 2개 모두 수락',
    parsed.entries.length === 4 && parsed.rejected.length === 0);
  check('혼합: 수락된 코드 버전이 1/1/2/2',
    parsed.entries.filter(e => e.v === 1).length === 2 &&
    parsed.entries.filter(e => e.v === 2).length === 2);
  const dupParsed = Core.parseRegistrationCodes([codes[0], codes[0]].join('\n'), room.id);
  check('혼합: 같은 코드 중복 검사도 버전 무관 동작 (DUPLICATE_CODE)',
    dupParsed.rejected.length === 1 && dupParsed.rejected[0].reason === 'DUPLICATE_CODE');
  const links = await Core.createPersonalLinks(room, parsed.entries);
  check('혼합: 개인 링크 버전이 각 코드의 버전을 따름',
    links.every(l => {
      const v = Core.parsePersonalLinkPayload(l.url.slice(3)).v;
      return v === ((l.n === '김철수' || l.n === '이영희') ? 1 : 2);
    }));
  const persons = links.map(l => l.n);
  const manitos = links.map(l => l.manito);
  check('혼합: 자기 배정·중복 배정 0건',
    persons.every((n, i) => n !== manitos[i]) && new Set(manitos).size === 4);
  let allOk = true;
  for (const link of links) {
    const revealed = await Core.openPersonalLink(link.url.slice(3), pins[link.n]);
    if (revealed !== link.manito) allOk = false;
  }
  check('혼합: 4명 모두 각자 비밀번호로 복호화 성공', allOk);
}

/* ------------------------------------------------------------------ */
/* 테스트 13. 잘린 v2 링크 (파싱 단계에서 차단)                           */
/* ------------------------------------------------------------------ */
section('테스트 13. 잘린 v2 링크는 파싱 단계에서 깨진 링크 처리');
{
  const room = Core.createRoom('잘림 방', dateAfter(7), '');
  const codes = [];
  for (const n of ['가', '나', '다']) {
    codes.push((await Core.createRegistrationCode(room, n, '123456', 2)).code);
  }
  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id).entries;
  const links = await Core.createPersonalLinks(room, entries);

  // 끝 1자·10자·50자 삭제: parse 단계에서 바로 BAD_LINK/BAD_ROOM이어야 한다
  const linkHash = links[0].url.slice(3);
  const roomHash = Core.roomLink(room).slice(3);
  const cutParseCode = (parseFn, hash, cut, expectedCode) => {
    let code = null;
    try { parseFn(hash.slice(0, hash.length - cut)); } catch (e) { code = e.code; }
    return code === expectedCode;
  };
  for (const cut of [1, 10, 50]) {
    check(`잘린 v2 개인 링크(끝 ${cut}자)는 파싱 단계에서 BAD_LINK`,
      cutParseCode(Core.parsePersonalLinkPayload, linkHash, cut, 'BAD_LINK'));
    check(`잘린 v2 방 링크(끝 ${cut}자)는 파싱 단계에서 BAD_ROOM`,
      cutParseCode(Core.parseRoomPayload, roomHash, cut, 'BAD_ROOM'));
  }

  let cutCodeFail = false;
  try {
    const r = Core.parseRegistrationCodes(codes[0].slice(0, -10), room.id);
    cutCodeFail = r.entries.length === 0 && r.rejected.length === 1 && r.rejected[0].reason === 'BROKEN';
  } catch (e) { cutCodeFail = false; }
  check('잘린 v2 등록 코드는 BROKEN으로 제외', cutCodeFail);
}

/* ------------------------------------------------------------------ */
/* 테스트 14. v3 P-256 BigInt 곡선 연산                                  */
/* ------------------------------------------------------------------ */
section('테스트 14. v3 P-256 BigInt 곡선 연산');
{
  const toBig = (b) => Core.bytesToBigInt(b);
  let curveOk = true;
  let compOk = true;
  for (let i = 0; i < 20; i++) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const d = toBig(Core.b64urlToBytes(jwk.d));
    const x = toBig(Core.b64urlToBytes(jwk.x));
    const y = toBig(Core.b64urlToBytes(jwk.y));
    const [cx, cy] = Core.p256ScalarMult(d);
    if (cx !== x || cy !== y) curveOk = false;
    const comp = Core.compressPoint(cx, cy);
    const back = Core.decompressPoint(comp);
    if (back.length !== 65 || back[0] !== 0x04 ||
        toBig(back.subarray(1, 33)) !== cx || toBig(back.subarray(33, 65)) !== cy) compOk = false;
    const compFromRaw = Core.compressRawPoint(raw);
    if (compFromRaw.length !== 33) compOk = false;
    for (let j = 0; j < 33; j++) if (compFromRaw[j] !== comp[j]) compOk = false;
  }
  check('JS로 계산한 d·G가 Web Crypto가 export한 JWK x,y와 일치 (20키)', curveOk);
  check('압축→복원이 원래 점과 일치, raw 압축과도 동일 (20키)', compOk);
  const bigX = new Uint8Array(33);
  bigX[0] = 0x02;
  for (let i = 1; i < 33; i++) bigX[i] = 255; // x ≥ p
  let badX = false;
  try { Core.decompressPoint(bigX); } catch (e) { badX = e.code === 'BAD_KEY'; }
  check('x ≥ p인 압축 키는 BAD_KEY', badX);
  const badPrefix = new Uint8Array(33);
  badPrefix[0] = 0x04;
  let badPrefix2 = false;
  try { Core.decompressPoint(badPrefix); } catch (e) { badPrefix2 = e.code === 'BAD_KEY'; }
  check('0x02/0x03이 아닌 압축 키는 BAD_KEY', badPrefix2);
}

/* ------------------------------------------------------------------ */
/* 테스트 15. v3 전 과정 시뮬레이션 (4명)                                  */
/* ------------------------------------------------------------------ */
section('테스트 15. v3 전 과정 시뮬레이션 (4명)');
{
  const room = Core.createRoom('v3 방 ✨', dateAfter(14), '1만원 이하');
  const people = [
    { name: '김철수', pin: '123456' },
    { name: '홍 길동', pin: '240815' },
    { name: '이👀수', pin: '903171' },
    { name: '박✨하늘', pin: '555000' },
  ];
  const codes = [];
  for (const person of people) {
    codes.push((await Core.createRegistrationCode(room, person.name, person.pin)).code);
  }
  check('v3: 등록 코드가 MANITO3- 접두어로 생성됨', codes.every(c => c.startsWith('MANITO3-')));
  check('v3: 페이로드가 URL 안전한 base64url만 사용',
    codes.every(c => /^[A-Za-z0-9_-]+$/.test(c.slice('MANITO3-'.length))));
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id, { rejectOldFormats: true });
  check('v3: 4개 코드 모두 수락됨', parsed.entries.length === 4 && parsed.rejected.length === 0);
  const url = await Core.createResultLink(room, parsed.entries);
  check('v3: 결과 링크가 #s= 해시이고 첫 바이트 0x03',
    url.startsWith('#s=') && Core.b64urlToBytes(url.slice(3))[0] === 0x03);
  const pay = Core.parseResultLinkPayload(url.slice(3));
  check('v3: 파싱 결과 방 정보·예산·이름 목록 유지',
    pay.v === 3 && pay.g === room.g && pay.d === room.d && pay.b === '1만원 이하' &&
    JSON.stringify(pay.names.slice().sort()) === JSON.stringify(people.map(p => p.name).sort()));
  const revealed = new Map();
  for (const person of people) {
    revealed.set(person.name, await Core.openResultLink(url.slice(3), person.name, person.pin));
  }
  const manitos = Array.from(revealed.values());
  check('v3: 전원이 결과 링크 하나로 각자 비밀번호로 자기 마니또 복호화',
    manitos.every(m => pay.names.includes(m)));
  check('v3: 자기 자신 배정 0건', people.every(p => revealed.get(p.name) !== p.name));
  check('v3: 중복 배정 0건', new Set(manitos).size === 4);
  check('v3: 마니또 집합이 전원 커버',
    JSON.stringify(manitos.slice().sort()) === JSON.stringify(pay.names.slice().sort()));
  let wrongBlocked = true;
  try { await Core.openResultLink(url.slice(3), '김철수', '000000'); wrongBlocked = false; }
  catch (e) { if (e.code !== 'WRONG_PIN') wrongBlocked = false; }
  check('v3: 틀린 비밀번호는 WRONG_PIN으로 차단', wrongBlocked);
  let otherNameBlocked = true;
  try { await Core.openResultLink(url.slice(3), '홍 길동', '123456'); otherNameBlocked = false; }
  catch (e) { if (e.code !== 'WRONG_PIN') otherNameBlocked = false; }
  check('v3: 다른 사람 이름 + 내 비밀번호도 WRONG_PIN', otherNameBlocked);
  const otherRoom = Core.createRoom('다른 v3 방', dateAfter(7), '');
  const otherCode = (await Core.createRegistrationCode(otherRoom, '외부인', '777777')).code;
  const mixed = Core.parseRegistrationCodes([codes[0], otherCode].join('\n'), room.id, { rejectOldFormats: true });
  check('v3: 다른 방 코드는 OTHER_ROOM으로 제외됨',
    mixed.entries.length === 1 && mixed.rejected.length === 1 &&
    mixed.rejected[0].reason === 'OTHER_ROOM' && mixed.rejected[0].name === '외부인');
  const oldV1 = (await Core.createRegistrationCode(room, '옛사람1', '111111', 1)).code;
  const oldV2 = (await Core.createRegistrationCode(room, '옛사람2', '222222', 2)).code;
  const withOld = Core.parseRegistrationCodes([oldV1, oldV2, codes[1]].join('\n'), room.id, { rejectOldFormats: true });
  check('v3: 이전 형식(MANITO1-/MANITO2-) 코드는 OLD_FORMAT으로 제외',
    withOld.entries.length === 1 && withOld.rejected.length === 2 &&
    withOld.rejected.every(r => r.reason === 'OLD_FORMAT'));
  const compat = Core.parseRegistrationCodes([oldV1, oldV2].join('\n'), room.id);
  check('v3: 기본 파서는 v1/v2 코드를 그대로 수락 (core 호환 흐름 유지)',
    compat.entries.length === 2 && compat.rejected.length === 0);
  let oldMatchBlocked = false;
  try { await Core.createResultLink(room, compat.entries); }
  catch (e) { oldMatchBlocked = e.code === 'OLD_FORMAT'; }
  check('v3: v1/v2 코드로는 결과 링크 생성 차단 (OLD_FORMAT)', oldMatchBlocked);
  const roomParsed = Core.parseRoomPayload(Core.roomLink(room).slice(3));
  check('v3: 방 링크는 v2 형식 유지', roomParsed.v === 2 && roomParsed.id === room.id && roomParsed.d === room.d);
}

/* ------------------------------------------------------------------ */
/* 테스트 16. v3 전 과정 시뮬레이션 (10명)                                 */
/* ------------------------------------------------------------------ */
section('테스트 16. v3 전 과정 시뮬레이션 (10명)');
{
  const room = Core.createRoom('열 명 방', dateAfter(7), '');
  const names = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'];
  const pins = {};
  names.forEach((n, i) => { pins[n] = String(111111 + i); });
  const codes = [];
  for (const n of names) {
    codes.push((await Core.createRegistrationCode(room, n, pins[n])).code);
  }
  const parsed = Core.parseRegistrationCodes(codes.join('\n'), room.id, { rejectOldFormats: true });
  check('v3: 10개 코드 모두 수락됨', parsed.entries.length === 10 && parsed.rejected.length === 0);
  const url = await Core.createResultLink(room, parsed.entries);
  const revealed = new Map();
  let selfOk = true;
  for (const n of names) {
    const m = await Core.openResultLink(url.slice(3), n, pins[n]);
    if (m === n) selfOk = false;
    revealed.set(n, m);
  }
  const manitos = Array.from(revealed.values());
  check('v3: 10명 전원이 결과 링크 하나로 자기 마니또 확인',
    selfOk && manitos.every(m => names.includes(m)));
  check('v3: 10명 자기 배정·중복 배정 0건', new Set(manitos).size === 10);
  check('v3: 10명 마니또 집합이 전원 커버',
    JSON.stringify(manitos.slice().sort()) === JSON.stringify(names.slice().sort()));
}

/* ------------------------------------------------------------------ */
/* 테스트 17. v3 결과 링크 파싱 방어                                     */
/* ------------------------------------------------------------------ */
section('테스트 17. v3 결과 링크 잘림·위조 방어');
{
  const room = Core.createRoom('방어 방', dateAfter(7), '');
  const codes = [];
  for (const n of ['가', '나', '다', '라']) {
    codes.push((await Core.createRegistrationCode(room, n, '123456')).code);
  }
  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id, { rejectOldFormats: true }).entries;
  const url = await Core.createResultLink(room, entries);
  const hash = url.slice(3);
  for (const cut of [1, 10]) {
    let code = null;
    try { Core.parseResultLinkPayload(hash.slice(0, hash.length - cut)); }
    catch (e) { code = e.code; }
    check(`잘린 v3 결과 링크(끝 ${cut}자)는 BAD_LINK`, code === 'BAD_LINK');
  }
  // 실제 페이로드를 재조립해 중복 이름·인원수 부족·깨진 암호문을 만든다
  const pay = Core.parseResultLinkPayload(hash);
  const days = Math.round((Date.UTC(+pay.d.slice(0, 4), +pay.d.slice(5, 7) - 1, +pay.d.slice(8, 10)) - Date.UTC(2020, 0, 1)) / 86400000);
  const build = (names, ciphers) => {
    const a = [0x03];
    for (const x of Core.b64urlToBytes(pay.r)) a.push(x);
    a.push((days >> 8) & 255, days & 255);
    const pushStr = (s) => { const u = new TextEncoder().encode(s); a.push(u.length); for (const x of u) a.push(x); };
    pushStr(pay.g);
    pushStr(pay.b || '');
    for (const x of pay.oneTimeComp) a.push(x);
    a.push(names.length);
    for (let i = 0; i < names.length; i++) { pushStr(names[i]); for (const x of ciphers[i]) a.push(x); }
    return Core.bytesToB64url(new Uint8Array(a));
  };
  let dupCode = null;
  try {
    Core.parseResultLinkPayload(build(
      [pay.names[0], pay.names[0], pay.names[1], pay.names[2]],
      [pay.ciphers[0], pay.ciphers[1], pay.ciphers[2], pay.ciphers[3]]));
  } catch (e) { dupCode = e.code; }
  check('중복 이름 목록은 BAD_LINK', dupCode === 'BAD_LINK');
  let fewCode = null;
  try {
    Core.parseResultLinkPayload(build([pay.names[0], pay.names[1]], [pay.ciphers[0], pay.ciphers[1]]));
  } catch (e) { fewCode = e.code; }
  check('인원수 2명 목록은 BAD_LINK (3~255 강제)', fewCode === 'BAD_LINK');
  let shortCipher = null;
  try {
    Core.parseResultLinkPayload(build(pay.names, [pay.ciphers[0].slice(0, 8), pay.ciphers[1], pay.ciphers[2], pay.ciphers[3]]));
  } catch (e) { shortCipher = e.code; }
  check('암호문이 9바이트가 아니면 BAD_LINK', shortCipher === 'BAD_LINK');
  let missingName = false;
  try { await Core.openResultLink(hash, '없는이름', '123456'); }
  catch (e) { missingName = e.code === 'BAD_LINK'; }
  check('목록에 없는 이름은 BAD_LINK', missingName);
  const r2 = Core.parseRegistrationCodes(codes[0].slice(0, -5), room.id, { rejectOldFormats: true });
  check('잘린 v3 등록 코드는 BROKEN으로 제외',
    r2.entries.length === 0 && r2.rejected.length === 1 && r2.rejected[0].reason === 'BROKEN');
}

/* ------------------------------------------------------------------ */
/* 테스트 18. v3 예산 미입력 방                                          */
/* ------------------------------------------------------------------ */
section('테스트 18. v3 예산 미입력 방 전 과정');
{
  const room = Core.createRoom('예산 없는 v3 방', dateAfter(7), '');
  const people = [
    { name: '김철수', pin: '111111' },
    { name: '이영희', pin: '222222' },
    { name: '박민수', pin: '333333' },
  ];
  const codes = [];
  for (const p of people) {
    codes.push((await Core.createRegistrationCode(room, p.name, p.pin)).code);
  }
  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id, { rejectOldFormats: true }).entries;
  const url = await Core.createResultLink(room, entries);
  const pay = Core.parseResultLinkPayload(url.slice(3));
  check('v3: 예산 미입력 방의 결과 링크에 예산 필드가 없음', !('b' in pay));
  let ok = true;
  for (const p of people) {
    const m = await Core.openResultLink(url.slice(3), p.name, p.pin);
    if (!pay.names.includes(m)) ok = false;
  }
  check('v3: 예산 없는 방에서도 전원 복호화 성공', ok);
}

/* ------------------------------------------------------------------ */
/* 테스트 19. v3 링크·코드 길이                                          */
/* ------------------------------------------------------------------ */
section('테스트 19. v3 링크·코드 길이');
{
  const room = Core.createRoom('26년 왕가네 마니또', dateAfter(30), '3만원');
  const ten = ['김철수', '이영희', '박민수', '최지우', '정하늘', '강다은', '윤서준', '한지민', '오세훈', '임수아'];
  const codes = [];
  for (const n of ten) {
    codes.push((await Core.createRegistrationCode(room, n, '123456')).code);
  }
  const entries = Core.parseRegistrationCodes(codes.join('\n'), room.id, { rejectOldFormats: true }).entries;
  const url10 = await Core.createResultLink(room, entries);
  const url5 = await Core.createResultLink(room, entries.slice(0, 5));
  const roomHash = Core.roomLink(room).slice(3);
  console.log(`  길이 — 방 링크 해시: ${roomHash.length}자, 등록 코드: ${codes[0].length}자, 결과 링크 해시(5명): ${url5.slice(3).length}자, 결과 링크 해시(10명): ${url10.slice(3).length}자`);
  check('v3: 등록 코드 90자 미만', codes.every(c => c.length < 90));
  check('v3: 10명 결과 링크 해시 500자 미만', url10.slice(3).length < 500);
  check('v3: 5명 결과 링크 해시 500자 미만', url5.slice(3).length < 500);
}

/* ------------------------------------------------------------------ */
/* 테스트 20. 구분자 없이 이어붙인 등록 코드 분리                          */
/* ------------------------------------------------------------------ */
section('테스트 20. 구분자 없이 이어붙인 등록 코드 분리');
{
  const room = Core.createRoom('이어붙임 방', dateAfter(7), '');
  const names = ['김철수', '이영희', '박민수'];
  const codes = [];
  for (const n of names) {
    codes.push((await Core.createRegistrationCode(room, n, '123456')).code);
  }
  // 구분자 없이 완전히 이어붙임 — input type=text에 여러 줄 붙여넣기 시 줄바꿈이 사라지는 상황 재현
  const glued = codes.join('');
  const parsed = Core.parseRegistrationCodes(glued, room.id, { rejectOldFormats: true });
  check('이어붙인 v3 코드 3개가 3명으로 인식됨',
    parsed.entries.length === 3 && parsed.rejected.length === 0 &&
    JSON.stringify(parsed.entries.map(e => e.n).sort()) === JSON.stringify(names.slice().sort()));
  const parsedDefault = Core.parseRegistrationCodes(glued, room.id);
  check('기본 파서도 이어붙인 v3 코드 3개를 인식함',
    parsedDefault.entries.length === 3 && parsedDefault.rejected.length === 0);

  // v1+v2+v3 코드가 이어붙은 경우 — 세 접두어 경계가 모두 끊어지는지
  const gluedMixed = [
    (await Core.createRegistrationCode(room, '옛사람1', '111111', 1)).code,
    (await Core.createRegistrationCode(room, '옛사람2', '222222', 2)).code,
    codes[0],
  ].join('');
  const parsedMixed = Core.parseRegistrationCodes(gluedMixed, room.id);
  check('v1+v2+v3 코드가 이어붙어도 3개로 인식됨',
    parsedMixed.entries.length === 3 && parsedMixed.rejected.length === 0);
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
