import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ResidentRoute({ children }) {
  const { user, isAdmin, isPendingAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">불러오는 중...</div>;
  // 임시 비밀번호로 로그인한 관리자는 입주민 화면이 아니라 비밀번호 변경 화면으로 보냅니다.
  if (user && isPendingAdmin) return <Navigate to="/admin/change-password" replace />;
  if (!user || isAdmin) return <Navigate to="/" state={{ from: location }} replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { user, isAdmin, isPendingAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (user && isPendingAdmin) return <Navigate to="/admin/change-password" replace />;
  if (!user || !isAdmin) return <Navigate to="/admin/login" state={{ from: location }} replace />;
  return children;
}
