import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import App from './App';
import { RuntimeConfig } from './types';

function AuthenticatedApp({ config }: { config: RuntimeConfig }) {
  const { signOut } = useAuthenticator();
  return <App config={config} onSignOut={signOut} />;
}

async function start() {
  const response = await fetch('/runtime-config.json');
  const config = await response.json() as RuntimeConfig;
  Amplify.configure({ Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId, loginWith: { email: true }, signUpVerificationMethod: 'code' } } });
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Authenticator loginMechanisms={['email']}><AuthenticatedApp config={config} /></Authenticator></React.StrictMode>);
}

start().catch((error) => { document.getElementById('root')!.textContent = `Unable to load VersionGuard configuration: ${error instanceof Error ? error.message : 'Unknown error'}`; });
