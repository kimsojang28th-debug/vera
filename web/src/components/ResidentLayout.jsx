import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconBuilding, IconCalendar, IconCheckSquare, IconUser } from './icons';

// 입주민 화면 공통 틀: 위쪽 네이비 헤더 + 아래쪽 탭바(휴대폰) / 헤더 아래 메뉴줄(PC)
export default function ResidentLayout() {
  const { household } = useAuth();

  return (
    <div className="app-shell resident-shell">
      <header className="res-header">
        <IconBuilding size={30} className="res-header-icon" />
        <div className="res-header-title">
          <span className="res-header-eyebrow">행사신청</span>
          <span className="res-header-name">래미안베라힐즈</span>
        </div>
        {household && (
          <span className="res-header-household">
            <IconUser size={15} />
            {household.dong}동 {household.ho}호
          </span>
        )}
      </header>

      <main className="page resident-page">
        <Outlet />
      </main>

      <nav className="tab-bar" aria-label="주요 메뉴">
        <NavLink to="/events" className="tab-item">
          <IconCalendar size={24} />
          <span>행사목록</span>
        </NavLink>
        <NavLink to="/my" className="tab-item">
          <IconCheckSquare size={24} />
          <span>나의 신청내역</span>
        </NavLink>
        <NavLink to="/me" className="tab-item">
          <IconUser size={24} />
          <span>내 정보</span>
        </NavLink>
      </nav>
    </div>
  );
}
