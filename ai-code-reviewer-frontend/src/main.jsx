import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const AppWrapper = () => {
  useEffect(() => {
    document.body.style.backgroundColor = 'lightblue';
  }, []);

  return <App />;
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>,
)