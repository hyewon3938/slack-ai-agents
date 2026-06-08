# design-notebook

마스터 단위 기능의 **설계 흐름 서사**를 기록하는 영구 문서.

## 다른 문서와의 차이

| 문서 | 역할 |
|------|------|
| `.claude/plans/` | 구현 직전 메모 (휘발) |
| **`docs/design-notebook/`** | **마스터 단위 서사 — 분기점·포기·회고** |
| `docs/adr/` | 되돌리기 어려운 결정 (불변 판례) |
| `docs/features.md` | 현재 어떤 기능이 있는지 한눈에 (카탈로그) |

design-notebook은 ADR이 다루지 않는 **결정에 이르기까지의 사고 흐름**을 담는다:
- 어떤 분기점이 있었고 왜 그쪽을 택했는지
- 무엇을 포기했고 왜
- 어떤 가설로 일단 가는지 (검증 시점 함께)
- 구현 후 회고

## 구조

```
docs/design-notebook/
├── README.md                       # 이 파일
├── insight-engine-v2.md            # 마스터 #393 — 프로액티브 인사이트 v2
├── fortune-rework.md               # 마스터 #421 — 사주 풀이 시스템 책임 분리 + 주간 분석 재설계
└── <master-slug>.md                # 다른 마스터 (있을 때마다)
```

마스터 이슈 1개당 파일 1개. Phase 별로 섹션 누적.

## 작성 시점

- 마스터 이슈 첫 설계 진입 시: 파일 생성
- 각 Phase 설계 시작 시: 새 섹션 append
- 각 Phase 머지 후: 회고 섹션 채움

## 작성 방식

[`/design` 스킬](../../.claude/skills/design/) 5-2 단계에서 자동 갱신. 수동 작성도 가능.

섹션 템플릿: 스킬의 `templates/design-notebook-section.md` 참조.

## 목록

- [insight-engine-v2.md](./insight-engine-v2.md) — 프로액티브 인사이트 v2 (마스터 #393)
- [fortune-rework.md](./fortune-rework.md) — 사주 풀이 시스템 책임 분리 + 주간 분석 재설계 (마스터 #421)
- [personal-pattern-discovery.md](./personal-pattern-discovery.md) — 본인 1명 패턴 발견 시스템 (마스터 #434)
- [metric-first-verification.md](./metric-first-verification.md) — 매트릭 중심 패턴 검증 (마스터 #477)
- [discovery-refinement.md](./discovery-refinement.md) — 발굴 엔진 측정 타당성 + 카드 UX (마스터 #504)
- [signal-seed-precision.md](./signal-seed-precision.md) — 신호·시드 측정 정밀화 (마스터 #508)
