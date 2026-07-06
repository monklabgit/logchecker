import { FormEvent, useState } from 'react';
import { LoaderCircle, LockKeyhole, LogIn, UserPlus } from 'lucide-react';
import { supabase } from './supabase';

type AuthMode = 'login' | 'signup';

const translateAuthError = (message: string) => {
  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('User already registered')) return 'Este e-mail já possui cadastro.';
  if (message.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (message.includes('Email not confirmed')) return 'Este e-mail ainda não foi confirmado.';
  return message;
};

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
          },
        });

        if (signUpError) throw signUpError;

        if (!data.session) {
          setNotice('Cadastro criado. A confirmação de e-mail ainda está ativa no Supabase.');
        }
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Não foi possível acessar.';
      setError(translateAuthError(message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <img className="auth-logo" src="/logo.png" alt="LogChecker" />

        <div className="auth-heading">
          <span className="auth-icon">
            <LockKeyhole size={22} />
          </span>
          <div>
            <h1>{mode === 'login' ? 'Acessar sistema' : 'Criar cadastro'}</h1>
            <p>{mode === 'login' ? 'Entre com seu e-mail e senha.' : 'Use seus dados profissionais para criar o acesso.'}</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Acesso">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => switchMode('login')}>
            Entrar
          </button>
          <button className={mode === 'signup' ? 'active' : ''} type="button" onClick={() => switchMode('signup')}>
            Cadastrar
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              <span>Nome</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </label>
          )}

          <label>
            <span>E-mail</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label>
            <span>Senha</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>

          {error && <p className="auth-message error">{error}</p>}
          {notice && <p className="auth-message notice">{notice}</p>}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : mode === 'login' ? <LogIn size={19} /> : <UserPlus size={19} />}
            <span>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar cadastro'}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
