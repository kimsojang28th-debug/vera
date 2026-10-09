import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { IconUser } from '../../components/icons';

export default function MyInfo() {
  const { household, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div>
      <h2 className="page-title">내 정보</h2>
      <section className="detail-card my-info-card">
        <div className="icon-circle icon-circle-lg"><IconUser size={24} /></div>
        <div>
          <div className="info-label">로그인한 세대</div>
          <div className="info-value">{household ? `${household.dong}동 ${household.ho}호` : '-'}</div>
        </div>
      </section>
      <button type="button" className="btn btn-block btn-danger logout-button" onClick={handleSignOut}>
        로그아웃
      </button>
    </div>
  );
}
