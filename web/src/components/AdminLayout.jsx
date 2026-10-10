import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconBuilding, IconCalendar, IconCheckSquare, IconLogout, IconSettings } from './icons';

// 관리자 화면 공통 틀: 위쪽 네이비 헤더 + 아래쪽 탭바(휴대폰) / 헤더 아래 메뉴줄(PC)
export default function AdminLayout() {
  const { user, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/admin/login');
  }

  return (
    <div className="app-shell admin-shell">
      <header className="res-header">
        <IconBuilding size={30} className="res-header-icon" />
        <div className="res-header-title">
          <span className="res-header-eyebrow">관리자</span>
          <span className="res-header-name">래미안베라힐즈</span>
        </div>
        <span className="admin-header-account">
          <span className="admin-header-email">{user?.email}</span>
          <button type="button" className="admin-header-logout" onClick={handleSignOut}>
            <IconLogout size={16} />로그아웃
          </button>
        </span>
      </header>

      <main className="page admin-page">
        <Outlet />
      </main>

      <nav className="tab-bar" aria-label="관리자 메뉴">
        <NavLink to="/admin/events" className="tab-item">
          <IconCalendar size={24} />
          <span>행사</span>
        </NavLink>
        <NavLink to="/admin/applications" className="tab-item">
          <IconCheckSquare size={24} />
          <span>신청현황</span>
        </NavLink>
        <NavLink to="/admin/households" className="tab-item">
          <IconBuilding size={24} />
          <span>동호수</span>
        </NavLink>
        <NavLink to="/admin/settings" className={`tab-item tab-item-settings${isSuperAdmin ? ' tab-item-keep' : ''}`}>
          <IconSettings size={24} />
          <span>설정</span>
        </NavLink>
      </nav>
    </div>
  );
}
