# 링크·코드 길이 줄이기 (형식 v2)

목표: 방 링크·등록 코드·개인 링크를 절반 이하로 줄인다. 보안 설계(ECDH P-256, PBKDF2 600,000회, HKDF→AES-GCM, 방장은 결과를 볼 수 없음)와 화면 동작은 그대로 둔다.

## 왜 긴가
지금은 JSON 안에 base64url 문자열(암호문·salt·JWK)을 넣고 그 JSON을 다시 base64url로 감싸 이중으로 부풀고, 개인키 JWK 전체(JSON)를 암호화해 담는다.

## v2 형식 — 바이너리를 base64url로 한 번만 인코딩
- 모든 v2 페이로드의 첫 바이트는 `0x02` (버전).
- 문자열 = `[길이 1바이트][UTF-8 바이트]` (길이 0~255). 길이 0 = 없음(예산 미입력).
- 공개일 = 2020-01-01부터의 일수, uint16 big-endian (2바이트).
- 방 ID = 6바이트 그대로.
- 공개키 = `exportKey('raw')` 65바이트(비압축).

| 페이로드 | 바이트 순서 |
|---|---|
| 방 링크 `#r=` | ver · 방ID(6) · 공개일(2) · 그룹이름(str) · 예산(str) |
| 등록 코드 `MANITO2-` | ver · 방ID(6) · 이름(str) · 공개키(65) · salt(16) · 암호화된 d(48) |
| 개인 링크 `#m=` | ver · 방ID(6) · 공개일(2) · 그룹이름(str) · 예산(str) · 받는사람이름(str) · salt(16) · 참가자 공개키(65) · 암호화된 d(48) · 일회용 공개키(65) · 마니또 이름 암호문([길이 1바이트][암호문]) — 길이·잔여 바이트를 엄격히 검사해 잘린 링크를 파싱 단계에서 차단 |

## 암호화 변경점
- **등록 시 개인키 전체 JWK 대신 개인키의 `d`(JWK의 d를 base64url 디코딩한 32바이트)만 암호화**한다 → 32 + 16(GCM 태그) = 48바이트.
  - 결과 확인 시 `{kty:'EC', crv:'P-256', x, y, d}` JWK를 다시 만들어 import한다. x, y는 개인 링크에 담긴 참가자 공개키(raw 65바이트: 0x04 · x32 · y32)에서 꺼낸다.
- **IV는 12바이트 0으로 고정**하고 링크에 넣지 않는다. 근거: (1) 비밀번호 키는 등록마다 새 랜덤 salt로 만들어 딱 한 번만 암호화에 쓰이고, (2) 마니또 이름 키는 매칭마다 새 일회용 ECDH 키로 만들어 딱 한 번만 쓰인다. 같은 키로 두 번 암호화하는 경로가 없음을 코드 주석으로 남긴다.
- 그 외(PBKDF2 600,000회 SHA-256, HKDF info, AES-GCM 256)는 그대로.

## 이름·문자열 길이 제한
UTF-8 바이트 기준 255를 넘지 않게: 그룹 이름 30자, 이름 20자, 예산 20자 이내(지금 제한 유지/추가). 이모지 포함해도 255바이트를 넘으면 안내 후 차단.

## 하위 호환 (중요 — 이미 v1 링크를 받아 쓰는 그룹이 있다)
- 해시 키는 그대로 `#r=`, `#m=`. 디코딩한 첫 바이트가 `{`(0x7B)면 기존 v1 JSON 경로, `0x02`면 v2 경로.
- 기존 v1 방 링크·v1 개인 링크·`MANITO1-` 등록 코드는 지금과 똑같이 동작해야 한다.
- 새로 만드는 방 링크·등록 코드·개인 링크는 v2. 옛 v1 방 링크로 접속한 참가자가 등록해도 새 v2 등록 코드를 만든다.
- 방 ID: v1은 6바이트를 base64url로 쓴 8글자 문자열, v2는 같은 6바이트 그대로. 내부에서는 항상 8글자 base64url 문자열로 통일해 비교한다(v2 파싱 시 6바이트 → 문자열, v2 직렬화 시 문자열 → 6바이트).
- 방장 모드에서 `MANITO1-`과 `MANITO2-` 코드를 섞어 붙여넣어도 받는다. 매칭 링크는 각 참가자 코드의 버전에 맞춰 만든다(v1 코드 → v1 개인 링크, v2 코드 → v2 개인 링크). 방 ID 비교·이름 중복·같은 코드 중복 검사는 버전과 무관하게 동작.

## 테스트 (tests/run-tests.mjs에 추가, 기존 46개는 모두 유지)
- v2: 4명 등록 → 매칭 → 전원 복호화, 틀린 비밀번호 차단, 다른 방 코드 제외, 예산 유무, 한글·공백·이모지 이름.
- 길이: 예산 있는 방에서 그룹 "26년 왕가네 마니또", 이름 3글자 한글 기준으로 방 링크 해시·등록 코드·개인 링크 해시 길이를 출력하고, 개인 링크 해시 < 500자, 등록 코드 < 260자인지 검사.
- 하위 호환: 아래 실제 v1 개인 링크 해시가 계속 파싱되어 결과 화면 정보(그룹 "26년 왕가네 마니또", 이름 "이다인", 공개일 2026-12-25)가 나오는지. (비밀번호는 모르므로 파싱까지만)
  `eyJ2IjoxLCJyIjoiZlBhTWVudFYiLCJnIjoiMjbrhYQg7JmV6rCA64SkIOuniOuLiOuYkCIsImQiOiIyMDI2LTEyLTI1IiwibiI6IuydtOuLpOyduCIsImVrIjoieEQ5dnpMYXhCbDhMZlk1ZFVUNjM0NU45b0wwZG40Rk1Qc0lmdmlac0tDZDhwSWpfQnFMdEdsQ3ZJYTRaRXRjWHNGd1FfZnNKaHBSTjVXNjJzcXJ2TEx6Qjg4SXFONldOazNpRFlleVpxWVJIRVNwVkxNdno4NUJmakVPamhHT19rV2ZIemxYWk90REJGalg3TGxYV245YTZzZVk4RGNRcjlQdHhxSjVRTlRNQXZmTlljR2RhT29LOF9TN2cwQ1VQcTQyQWVDLXc2WU5PaS12UlRaaVp1dGpqYmhCT1FsZ3c5Tmt5cjdBTVZNeDVtRHFQOTd6VlNJOURDTU9KU1NqYSIsInMiOiJZLTdQbUlVSFJkcUJPUHg0TUE0d3VRIiwiaSI6InB5a0ZVcE01SEtiam1kaUoiLCJvayI6eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Im5mN3pJem1SNmJkb2dWUkFHM29wZUpJdUdWMEdxZVhGVnBhci1iZjNxSzQiLCJ5IjoiUEx5VlktUVItdVVub0s5QS1xdmNOaF85OEstRDVxd0k0ei1TUndxYTI3WSJ9LCJjIjoiN3VaS2trb09fSTNZMkpYdHZxbTAyOHFEalRoSE5weFQzQSIsInciOiJMRlkydmxMWmJrX1JVeVdKIn0`
- 혼합: v1 코드 2개 + v2 코드 2개(같은 방)를 섞어 매칭 → 4명 모두 각자 비밀번호로 복호화, 자기 배정·중복 0.
- 잘린 v2 링크(끝 10자 삭제)는 BAD_LINK/BAD_ROOM으로 깨진 링크 처리.
