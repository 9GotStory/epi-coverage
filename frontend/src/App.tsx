import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';

export default function App() {
  return (
    <>
      <Toaster position="top-right" richColors expand={true} />
      <Outlet />
    </>
  )
}
