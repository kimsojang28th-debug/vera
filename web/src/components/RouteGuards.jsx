import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ResidentRoute({ children }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!user || isAdmin) return <Navigate to="/" state={{ from: location }} replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!user || !isAdmin) return <Navigate to="/admin/login" state={{ from: location }} replace />;
  return children;
}
