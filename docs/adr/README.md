# Architecture Decision Records (ADR)

되돌리기 어려운 설계 판단을 기록하는 문서.
**"왜 이렇게 했는가"** 를 남긴다. 구현 세부사항이 아니라 **판단의 근거**가 핵심이다.

---

## ADR이란

설계 판단 중 **되돌리기 어렵고, 여러 선택지를 놓고 고민했고, 판단 기준을 남길 가치가 있는 것**만 ADR로 기록한다.

구현 완료 기록은 [docs/project-history.md](../project-history.md)가 담당한다. ADR은 **판단의 맥락(Context)과 트레이드오프(Consequences)** 를 남기는 데 집중한다.

### 왜 필요한가

- 6개월 뒤 과거의 내가 "왜 이렇게 짰지?" 할 때 답이 된다
- 비슷한 선택이 다시 나왔을 때 같은 고민을 반복하지 않는다
- 외부에 프로젝트를 소개할 때 "어떤 판단을 거쳐 지금 구조가 됐는가"를 보여줄 수 있다

---

## 포맷 — Michael Nygard 형식

```markdown
# <번호>. <짧은 제목>

- Status: Accepted | Superseded by ADR-xxxx | Deprecated
- Date: YYYY-MM-DD
- Related: #이슈번호, PR #PR번호
- Tags: infra | data | security | process | ...

## Context
어떤 상황에서 이 판단이 필요했는가. 배경과 제약 조건.

## Decision
무엇을 선택했는가. 구체적 구조·도구·방법.

## Alternatives considered
어떤 대안을 놓고 고민했는가. 각각의 장단점.

## Consequences
이 선택이 가져온 결과.
- 장점
- 단점 / 제약
- 앞으로 이것 때문에 추가로 할 일
```

---

## 기록 기준 — 언제 ADR을 쓰는가

아래 조건 중 **2개 이상** 해당되면 ADR 작성:

- [ ] **되돌리기 어렵다** — 바꾸려면 여러 파일·문서·외부 시스템 동시 변경 필요
- [ ] **대안이 있었다** — 하나 이상의 대안을 놓고 고민했고, 트레이드오프가 존재
- [ ] **장기 영향이 크다** — 6개월\~1년 뒤에도 이 판단을 참조할 일이 있음
- [ ] **온보딩에서 설명이 필요하다** — "왜 이렇게 짰지?" 하고 새로 합류한 사람이 물어볼 만함
- [ ] **판단 근거가 비자명하다** — 코드만 봐서는 왜 그렇게 짰는지 바로 안 보임

### ADR이 **아닌** 것

- 단순 기능 추가 (예: 새 API 엔드포인트 추가) → `docs/project-history.md`
- 버그 수정 → 커밋 메시지 + 이슈
- 코드 스타일·네이밍 → `docs/conventions.md`
- 라이브러리 버전 업 (호환성 이슈 없으면) → PR만

### 판단이 애매하면

**작게라도 기록하는 쪽**을 선택한다. 나중에 "쓸걸" 하는 비용이 "썼는데 별 내용 아님"의 비용보다 크다.

---

## 운영 규칙

### 파일명

```
docs/adr/NNNN-<kebab-case-제목>.md
```

- `NNNN` — 4자리 zero-padded 번호 (0001, 0002, ...)
- 제목은 간결하게. ADR 자체의 짧은 제목 (예: `0005-uptime-monitoring-github-actions.md`)

### 번호 부여

- 다음 번호를 쓴다. 비어 있는 번호를 재활용하지 않는다
- 동시에 여러 PR에서 ADR을 쓰는 경우 먼저 머지되는 쪽이 낮은 번호를 가진다

### 불변성 (Immutability)

- 한번 `Accepted` 된 ADR의 **Decision / Context / Alternatives / Consequences 본문은 수정하지 않는다**
- 판단이 바뀌면 → **새 ADR**을 만들고, 기존 ADR의 Status를 `Superseded by ADR-NNNN`으로 업데이트
- 오탈자·링크 깨짐 같은 건 수정 가능

### Status 라이프사이클

- `Proposed` — 작성 중, 아직 합의 안 됨
- `Accepted` — 합의 완료. 현재 유효
- `Superseded by ADR-NNNN` — 후속 ADR로 대체됨
- `Deprecated` — 더 이상 유효하지 않으나 대체 ADR 없음

개인 프로젝트에서는 대부분 바로 `Accepted`로 작성하고, 후에 `Superseded`로 전환한다.

---

## 인덱스

| 번호 | 제목 | Status | Date | Tags |
|------|------|--------|------|------|
| [0001](0001-sql-tool-llm-agent.md) | SQL 도구 기반 LLM 에이전트 설계 | Accepted | 2026-03-08 | architecture, llm, data |
| [0002](0002-v3-architecture-split.md) | v3 아키텍처 — Vercel 웹 + VM 봇 + managed DB | Accepted | 2026-03-12 | infra, architecture |
| [0003](0003-self-hosted-postgres.md) | DB 자가 호스팅 전환 (Neon → VM PostgreSQL) | Accepted | 2026-04-06 | infra, data |
| [0004](0004-db-proxy-api.md) | DB Proxy API 패턴 — Vercel→VM DB 직결 제거 | Accepted | 2026-04-09 | infra, security |
| [0005](0005-uptime-monitoring-github-actions.md) | GitHub Actions 기반 자체 업타임 모니터링 | Accepted | 2026-04-22 | infra, observability |

> **주**: ADR 0001\~0004는 2026-04-22 이후 소급 기록된 백필이다. 원본 판단 근거는 [docs/project-history.md](../project-history.md)와 관련 PR에 남아있으며, 각 ADR의 Date는 실제 판단이 내려진 시점을 사용했다.

---

## 템플릿

새 ADR을 작성할 때는 [template.md](template.md)를 복사해서 쓴다.

```bash
# 다음 번호 확인
ls docs/adr/ | grep -E '^[0-9]{4}-' | tail -1

# 복사
cp docs/adr/template.md docs/adr/NNNN-<제목>.md
```
