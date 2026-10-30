import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { PortalShell } from './shell/PortalShell';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { LoginPage } from './pages/LoginPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientFormPage } from './pages/PatientFormPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<PortalShell />}>
              <Route
                index
                element={
                  <PlaceholderPage
                    title="Bem-vindo ao Medica Certo"
                    description="Você está autenticado. Cadastre pacientes em Pacientes; medicamentos entram na PR4."
                    showHealth
                  />
                }
              />
              <Route path="pacientes" element={<PatientsPage />} />
              <Route path="pacientes/novo" element={<PatientFormPage />} />
              <Route path="pacientes/:id" element={<PatientFormPage />} />
              <Route
                path="medicamentos"
                element={
                  <PlaceholderPage
                    title="Medicamentos"
                    description="Catálogo de medicamentos entra na PR4."
                  />
                }
              />
              <Route
                path="configuracoes"
                element={
                  <PlaceholderPage
                    title="Configurações"
                    description="Preferências de alarmes e push entram nas PRs 8–9."
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
