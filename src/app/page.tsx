import { MohasbaAppShell } from '@/client/components/app-shell';
import { MohasbaProvider } from '@/client/store/mohasba-provider';

export default function HomePage() {
  return (
    <MohasbaProvider>
      <MohasbaAppShell />
    </MohasbaProvider>
  );
}
