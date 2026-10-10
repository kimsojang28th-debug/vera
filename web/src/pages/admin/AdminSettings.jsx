import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { IconLogout, IconUser } from '../../components/icons';
import AdminAccounts from './AdminAccounts';

// 모바일에서 상단에서 뺀 계정 정보와 로그아웃을 모아 둔 화면
export default function AdminSettings() {
  const { user, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/admin/login');
  }

  return (
    <div>
      <h2 className="page-title">설정</h2>

      <section className="detail-card">
        <div className="info-line">
          <span className="info-icon"><IconUser size={20} /></span>
          <div>
            <div className="info-label">로그인한 관리자</div>
            <div className="info-value">{user?.email || '-'}</div>
          </div>
        </div>
        <div className="detail-divider" />
        <button type="button" className="btn btn-block" onClick={handleSignOut}>
          <IconLogout size={18} />로그아웃
        </button>
      </section>

      {isSuperAdmin && <AdminAccounts />}
    </div>
  );
}
