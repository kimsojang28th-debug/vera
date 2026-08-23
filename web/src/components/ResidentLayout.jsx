import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ResidentLayout() {
  const { household, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <Link to="/events" className="brand">래미안베라힐즈 행사신청</Link>
        <nav>
          <Link to="/events">행사목록</Link>
          <Link to="/my">나의 신청내역</Link>
          {household && <span className="household-badge">{household.dong}동 {household.ho}호</span>}
          <button className="link-button" onClick={handleSignOut}>로그아웃</button>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
