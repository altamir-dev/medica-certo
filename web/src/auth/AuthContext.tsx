import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type Caregiver,
} from '../api/auth';
import { ApiError } from '../api/client';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  caregiver: Caregiver | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [caregiver, setCaregiver] = useState<Caregiver | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { caregiver: me } = await fetchMe();
      setCaregiver(me);
      setStatus('authenticated');
    } catch (err) {
      setCaregiver(null);
      if (err instanceof ApiError && err.status === 401) {
        setStatus('anonymous');
        return;
      }
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { caregiver: me } = await apiLogin(email, password);
    setCaregiver(me);
    setStatus('authenticated');
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name: string }) => {
      const { caregiver: me } = await apiRegister(input);
      setCaregiver(me);
      setStatus('authenticated');
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setCaregiver(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      caregiver,
      login,
      register,
      logout,
      refresh,
    }),
    [status, caregiver, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
