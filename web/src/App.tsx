import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PortalShell } from './shell/PortalShell';
import { PlaceholderPage } from './pages/PlaceholderPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PortalShell />}>
          <Route
            index
            element={
              <PlaceholderPage
                title="Bem-vindo ao Medica Certo"
                description="Casco visual pronto. Próximo passo: autenticação do cuidador (PR2)."
                showHealth
              />
            }
          />
          <Route
            path="pacientes"
            element={
              <PlaceholderPage
                title="Pacientes"
                description="Cadastro de pacientes entra na PR3."
              />
            }
          />
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
      </Routes>
    </BrowserRouter>
  );
}
