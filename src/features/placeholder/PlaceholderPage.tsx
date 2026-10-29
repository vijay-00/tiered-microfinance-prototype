import { Construction } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { PHASE_NAMES, type Screen } from '@/app/screens';

/** A real route whose page a later phase builds. It says which, and what it will hold. */
export function PlaceholderPage({ screen }: { screen: Screen }) {
  const params = useParams();
  const subject = Object.values(params).find(Boolean);
  return (
    <>
      <PageHeader title={subject ? `${screen.title} · ${subject}` : screen.title} description={screen.summary} />
      <Card>
        <CardContent className="flex items-start gap-3">
          <Construction className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">
              Built in Phase {screen.phase}: {PHASE_NAMES[screen.phase]}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The route, navigation and permissions are in place. The figures this screen will show already exist in
              the engine; advance the clock in the demo bar to see them move on the dashboard.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
