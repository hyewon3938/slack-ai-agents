# 0021. web shared 사주 계산 코드 — 복제 방식 채택

- Status: Accepted
- Date: 2026-05-26
- Related: #427
- Tags: process, web, shared-code

## Context

이 프로젝트는 봇(`src/`)과 웹 대시보드(`web/src/`)가 같은 repo 안 다른 디렉토리로 분리되어 운영된다. 둘은 독립적인 `tsconfig.json`을 가지며, web의 `@/*` alias는 `web/src/*`만 가리켜 봇의 `src/shared`를 import할 수 없다.

이번에 캘린더 주간·일간 뷰에 사주 일주를 표시하려면, 봇에 있던 `getDayPillar()` 함수(`src/shared/saju-calendar.ts`)를 웹에서도 호출해야 한다.

제약:
- web은 Vercel에 배포되어 봇 서버의 코드에 접근 불가 (런타임/빌드타임 모두)
- 봇은 Oracle VM Docker 컨테이너로 별도 빌드·배포
- 일주 계산은 순수 함수 — 입력(date string) → 출력(Pillar), DB·외부 I/O 없음
- 60갑자 순환 알고리즘은 거의 변경되지 않음 (2024-02-04 기준 index 34 = 戊戌, 검증된 상수)

## Decision

**web에서 사용할 일주 계산 함수를 `web/src/lib/saju.ts`로 복제한다.**

복제 범위는 최소화 — `getDayPillar`와 그 직접 의존성만 (~50줄):

- 타입: `Pillar`, `Cheongan`, `Jiji`
- 상수: `CHEONGAN_LIST`, `JIJI_LIST`, `CHEONGAN_HANJA`, `JIJI_HANJA`
- 헬퍼: `parseDate`, `daysDiff`, `indexToPillar`
- 메인: `getDayPillar(dateStr: string): Pillar`

`getYearPillar` / `getMonthPillar` / 십성 / 십이운성 등 다른 함수는 절기 데이터·일간 컨텍스트가 필요하고 봇 전용이므로 복제 대상에서 제외.

복제본 상단에 `src/shared/saju-calendar.ts`의 동기화 책임을 주석으로 명시:

```ts
/**
 * 사주 일주 계산 (web용 복제본).
 * 원본: src/shared/saju-calendar.ts (봇 사용).
 * 동기화 대상: getDayPillar 알고리즘 + 천간/지지 상수.
 * 변경 시 양쪽 모두 갱신할 것 (ADR-0021 참조).
 */
```

## Alternatives considered

### A. 봇 API 경유 (DB Proxy 패턴 확장)

봇 서버에 `GET /api/saju/day-pillar?date=YYYY-MM-DD` 엔드포인트를 추가하고, web에서 fetch로 호출.

- 장점: 단일 진실의 소스 유지. 알고리즘 수정 시 한 곳만.
- 단점: 매번 네트워크 호출 — 주간 뷰는 7일치 × 매 페이지 로드. 봇 서버 다운 시 캘린더 사용 불가 (현재는 무관). 캐싱 레이어 별도 필요.
- 기각 이유: 순수 함수에 네트워크 비용을 얹는 건 과함. 캘린더가 봇 서버 가용성에 결합되는 것도 회피하고 싶음.

### B. packages/shared-saju 모노레포 분리

루트에 `packages/shared-saju` 디렉토리 신설하고, 봇/웹 양쪽에서 import. pnpm workspaces 또는 npm workspaces 도입.

- 장점: 진정한 단일 소스. 동기화 부담 0. 다른 shared 로직(예: `kst.ts`)에도 동일 패턴 적용 가능.
- 단점: 빌드 시스템 큰 변경. Vercel 배포 설정(monorepo 모드) 조정 필요. 봇의 Docker 빌드 컨텍스트도 재설계. 현재 코드 공유 이슈가 이 한 건뿐이라 ROI 낮음.
- 기각 이유: 단발 이슈 하나 때문에 빌드 시스템 전체를 건드리는 건 명백한 오버엔지니어링. 코드 공유 이슈가 2\~3건 더 누적되면 그때 재검토.

### C. web/src/lib/saju.ts 복제 (Decision 채택안)

- 장점: 변경 즉시 효과. 외부 의존성 0. 빌드 시스템 무변경. ~50줄 순수 함수라 검증 가능.
- 단점: 알고리즘 수정 시 두 곳 동기화 필요. 누락 시 봇/웹이 다른 일주를 표시할 위험.

## Consequences

### 장점

- 캘린더 일주 표시 기능 구현·배포가 web 단독으로 가능 (봇 서버 변경 0)
- 봇 서버 가용성과 캘린더 가용성이 독립
- 클라이언트에서 계산 → 7일치 계산도 1ms 미만

### 단점 / 제약

- `getDayPillar` 알고리즘 또는 천간/지지 상수가 바뀌면 양쪽 동기화 필수
  - 완화: 복제본 상단 주석에 동기화 책임 명시
  - 완화: 알고리즘은 결정론적·검증된 상수라 변경 가능성 낮음
- 다른 사주 함수(`getYearPillar`, 십성 등)를 web에서 쓰려면 같은 복제 패턴이 반복될 가능성

### 후속 작업

- [ ] `web/src/lib/saju.ts` 신규 작성 + 상단 동기화 주석
- [ ] 두 번째 코드 공유 이슈가 생기면 ADR-B(모노레포 분리) 재검토
- [ ] 봇 측 `saju-calendar.ts`의 일주 계산 부분 수정 시 web 측 동기화 점검을 PR 체크리스트에 추가 (선택)

---

**참고 자료**

- 원본 함수: [src/shared/saju-calendar.ts:414](../../src/shared/saju-calendar.ts)
- 60갑자 기준일: 2024-02-04 = 戊戌 (index 34). 검증: 2026-03-14 = 丁亥 (index 23)
