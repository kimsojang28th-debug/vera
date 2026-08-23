import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';

// 입주민(동/호수 커스텀 토큰)과 관리자(이메일/비밀번호)가 같은 Firebase Auth 인스턴스를 공유합니다.
// 로그인 시점에 발급된 custom claim(admin: true) 여부로 두 모드를 구분합니다.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const tokenResult = await u.getIdTokenResult();
      setUser(u);
      setIsAdmin(tokenResult.claims.admin === true);
      setLoading(false);
    });
    return unsub;
  }, []);

  // 입주민 uid는 households 문서ID와 동일하게 "{동}-{호}" 형식으로 발급됩니다 (functions/index.js householdLogin 참고)
  const household = user && !isAdmin && user.uid.includes('-')
    ? { dong: user.uid.split('-')[0], ho: user.uid.split('-').slice(1).join('-') }
    : null;

  async function signOutUser() {
    await firebaseSignOut(auth);
  }

  const value = { user, isAdmin, household, loading, signOut: signOutUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
