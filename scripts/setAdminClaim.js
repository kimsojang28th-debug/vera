// 관리자 계정에 admin custom claim을 부여하는 1회성 스크립트입니다.
// 보안상 공개 함수로 만들지 않고, 관리자가 로컬에서 서비스 계정 키로 직접 실행합니다.
//
// 사용법:
//   1. Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성" 으로
//      service-account.json 을 내려받아 scripts/ 폴더에 둡니다. (git에 커밋 금지!)
//   2. Firebase 콘솔 > Authentication 에서 관리자로 쓸 이메일 계정을 먼저 생성합니다.
//   3. node scripts/setAdminClaim.js admin@example.com
//
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const email = process.argv[2];

if (!email) {
  console.error('사용법: node scripts/setAdminClaim.js <admin-email>');
  process.exit(1);
}

const serviceAccountPath = path.join(__dirname, 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));

initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { admin: true });

console.log(`${email} (uid: ${user.uid}) 계정에 admin 권한을 부여했습니다.`);
console.log('해당 계정으로 다시 로그인해야 권한이 적용됩니다.');
