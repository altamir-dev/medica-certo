import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { PortalShell } from './shell/PortalShell';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientFormPage } from './pages/PatientFormPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { MedicationsPage } from './pages/MedicationsPage';
import { MedicationFormPage } from './pages/MedicationFormPage';
import { TreatmentFormPage } from './pages/TreatmentFormPage';
import { TreatmentDetailPage } from './pages/TreatmentDetailPage';
import { TreatmentGradePage } from './pages/TreatmentGradePage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<PortalShell />}>
              <Route index element={<HomePage />} />
              <Route path="pacientes" element={<PatientsPage />} />
              <Route path="pacientes/novo" element={<PatientFormPage />} />
              <Route path="pacientes/:id/editar" element={<PatientFormPage />} />
              <Route
                path="pacientes/:id/tratamentos/novo"
                element={<TreatmentFormPage />}
              />
              <Route path="pacientes/:id" element={<PatientDetailPage />} />
              <Route path="medicamentos" element={<MedicationsPage />} />
              <Route
                path="medicamentos/novo"
                element={<MedicationFormPage />}
              />
              <Route
                path="medicamentos/:id"
                element={<MedicationFormPage />}
              />
              <Route
                path="tratamentos/:id/grade"
                element={<TreatmentGradePage />}
              />
              <Route path="tratamentos/:id" element={<TreatmentDetailPage />} />
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
