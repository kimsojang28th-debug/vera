import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconBuilding } from './icons';

export default function AdminLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/admin/login');
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <span className="brand"><IconBuilding size={20} />관리자 모드</span>
        <nav>
          <NavLink to="/admin/events">행사배너 관리</NavLink>
          <NavLink to="/admin/applications">신청현황</NavLink>
          <NavLink to="/admin/households">동호수관리</NavLink>
          <span className="household-badge">{user?.email}</span>
          <button className="link-button" onClick={handleSignOut}>로그아웃</button>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
