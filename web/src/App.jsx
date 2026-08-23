import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ResidentRoute, AdminRoute } from './components/RouteGuards';
import ResidentLayout from './components/ResidentLayout';
import AdminLayout from './components/AdminLayout';

import Login from './pages/resident/Login';
import EventList from './pages/resident/EventList';
import EventDetail from './pages/resident/EventDetail';
import MyApplications from './pages/resident/MyApplications';

import AdminLogin from './pages/admin/AdminLogin';
import AdminEvents from './pages/admin/AdminEvents';
import AdminEventForm from './pages/admin/AdminEventForm';
import AdminApplications from './pages/admin/AdminApplications';
import AdminHouseholds from './pages/admin/AdminHouseholds';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/admin/login" element={<AdminLogin />} />

          <Route
            element={
              <ResidentRoute>
                <ResidentLayout />
              </ResidentRoute>
            }
          >
            <Route path="/events" element={<EventList />} />
            <Route path="/events/:eventId" element={<EventDetail />} />
            <Route path="/my" element={<MyApplications />} />
          </Route>

          <Route path="/admin" element={<Navigate to="/admin/events" replace />} />
          <Route
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route path="/admin/events" element={<AdminEvents />} />
            <Route path="/admin/events/new" element={<AdminEventForm />} />
            <Route path="/admin/events/:eventId" element={<AdminEventForm />} />
            <Route path="/admin/applications" element={<AdminApplications />} />
            <Route path="/admin/households" element={<AdminHouseholds />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
