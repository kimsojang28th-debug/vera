# 래미안베라힐즈 행사 신청 시스템

동/호수 기반 로그인으로 입주민이 행사(원데이클래스, 물놀이, 대사증후군 검사 등)를 온라인으로 신청·조회·수정·취소할 수 있는 시스템입니다. 설계 배경과 아키텍처 상세 설명은 `래미안베라힐즈_행사신청시스템_개발가이드.md` 문서를 함께 참고해주세요. 이 README는 실제 설정·배포 절차에 집중합니다.

## 폴더 구조

```
web/         React(Vite) 프론트엔드 — 입주민/관리자 화면
functions/   Cloud Functions — 로그인, 신청 접수, 마스킹 조회 등 서버 로직
scripts/     관리자 계정에 admin 권한을 부여하는 1회성 스크립트
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
.github/workflows/deploy.yml   GitHub Actions 자동 배포
```

## 0. 사전 준비물

- Node.js 20 이상
- Firebase CLI: `npm install -g firebase-tools`
- Firebase 프로젝트 (이미 `vera`라는 이름으로 생성하셨다고 하셨습니다. 콘솔에서 실제 프로젝트 ID를 확인해주세요 — 이름이 겹치면 `vera-xxxxx` 처럼 접미사가 붙었을 수 있습니다. 다르다면 `.firebaserc`의 `default` 값을 실제 ID로 바꿔주세요.)

## 1. Firebase 콘솔에서 해야 할 설정 (최초 1회)

1. **Firestore 만들기**: 콘솔 > Firestore Database > 데이터베이스 만들기 → **리전을 반드시 `asia-northeast3` (서울)로 선택**합니다. 개발가이드 7장에서 설명한 개인정보 국외이전 이슈를 피하기 위한 필수 설정이며, 한번 정하면 나중에 바꿀 수 없습니다.
2. **Authentication 활성화**: 콘솔 > Authentication > Sign-in method에서 "이메일/비밀번호" 제공업체를 사용 설정합니다. (관리자 로그인용. 입주민 로그인은 Cloud Functions가 발급하는 커스텀 토큰을 사용하므로 별도 설정이 필요 없습니다.)
3. **관리자 계정 생성**: 콘솔 > Authentication > Users에서 관리자가 쓸 이메일/비밀번호 계정을 하나 만듭니다. (예: office@yourdomain.com)
4. **요금제를 Blaze(종량제)로 전환**: 콘솔 > 요금제. Cloud Functions를 쓰려면 필수입니다. 개발가이드 9장에서 설명했듯, 이 규모의 트래픽에서는 실제 과금이 거의 발생하지 않지만 예산 알림(Budget Alert) 설정을 권장합니다.
5. **웹 앱 등록**: 콘솔 > 프로젝트 설정 > 일반 > "앱 추가" > 웹(&#60;/&#62;) 선택 → 발급되는 `firebaseConfig` 값을 아래 2번 단계에서 사용합니다.

## 2. 로컬 환경변수 설정

```bash
cd web
cp .env.example .env.local
# .env.local을 열어 1-5에서 발급받은 firebaseConfig 값을 채워넣습니다.
```

## 3. 로컬에서 실행해보기

```bash
# Firebase CLI 로그인 및 프로젝트 연결 확인
firebase login
firebase use vera   # 실제 프로젝트 ID로 수정

# 프론트엔드 개발 서버
cd web
npm install
npm run dev
```

Cloud Functions까지 포함해 로컬에서 통합 테스트하려면 Firebase 에뮬레이터를 사용하세요.

```bash
cd functions && npm install && cd ..
firebase emulators:start --only functions,firestore,auth,hosting
```

에뮬레이터로 테스트할 때는 `web/src/firebase.js`에 에뮬레이터 연결 코드를 추가해야 합니다 (`connectFirestoreEmulator`, `connectFunctionsEmulator`, `connectAuthEmulator`). 실제 운영 배포 전 단계에서 필요하면 말씀해주세요.

## 4. 관리자 권한(admin custom claim) 부여

일반 이메일/비밀번호 계정만으로는 관리자 메뉴에 들어갈 수 없습니다. `admin: true` 커스텀 클레임을 부여해야 합니다.

1. 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성" → 다운로드한 JSON을 `scripts/service-account.json`으로 저장합니다. **이 파일은 절대 GitHub에 올리지 마세요** (`.gitignore`에 이미 등록되어 있습니다).
2. ```bash
   cd scripts
   npm install
   node setAdminClaim.js office@yourdomain.com
   ```
3. 해당 계정으로 관리자 로그인 화면에서 다시 로그인하면 관리자 메뉴가 보입니다.

## 5. 수동 배포

```bash
cd web && npm run build && cd ..
firebase deploy --only hosting,functions,firestore:rules,firestore:indexes
```

## 6. GitHub 업로드 + 자동 배포(GitHub Actions)

이 폴더는 이미 로컬 git 저장소로 초기화되어 있습니다. GitHub에 새 저장소를 만든 뒤 연결하세요.

```bash
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git branch -M main
git push -u origin main
```

`main` 브랜치에 push하면 자동으로 배포되도록 `.github/workflows/deploy.yml`을 만들어두었습니다. 다음 GitHub Secrets를 저장소 Settings > Secrets and variables > Actions에 등록해야 동작합니다.

| Secret 이름 | 값 |
|---|---|
| `VITE_FIREBASE_API_KEY` 외 5개 | `web/.env.local`에 채운 값과 동일 |
| `FIREBASE_SERVICE_ACCOUNT` | 4단계에서 받은 `service-account.json` 파일의 **전체 내용**(JSON 텍스트 그대로) |

Secrets 등록 후에는 GitHub Actions 탭에서 수동 실행(workflow_dispatch)도 가능합니다.

## 7. 첫 행사 등록 체크리스트

1. 관리자 로그인 → 동호수관리에서 입주 세대(동/호수, 가능하면 성명)를 등록 (개별 또는 일괄 CSV 붙여넣기)
2. 관리자 로그인 → 행사배너 관리에서 새 행사 등록. 공개 상태를 "모집중"으로 바꿔야 입주민 화면에 노출됩니다.
3. 입주민 화면(`/`)에서 등록된 동/호수 + 임의의 비밀번호로 최초 접속 → 자동 등록되는지 확인
4. 신청 → 나의 신청내역에서 수정/취소 → 관리자 신청현황에서 반영되는지 확인
5. 정원을 1~2명으로 낮춘 테스트 행사를 만들어 정원 마감 처리가 정상 동작하는지 확인

## 8. 알려진 제한사항 / 다음 단계

개발가이드 10장의 로드맵과 동일합니다. 이번 1단계(MVP)에는 포함하지 않은 항목입니다.

- 배너 이미지는 파일 업로드가 아니라 URL 입력 방식입니다. 이미지 업로드가 필요하면 Firebase Storage 연동을 추가해야 합니다.
- 비밀번호 분실 시 관리자가 "동호수관리"에서 비밀번호를 초기화해주는 방식입니다. 문자(SMS) 인증 연동은 2단계 과제입니다.
- 신청 완료/취소 시 문자·카카오 알림톡 발송은 아직 없습니다.
- 정원 초과 시 대기신청, 관리자 통계 대시보드, 다중 관리자 권한 분리는 2~3단계 과제입니다.
