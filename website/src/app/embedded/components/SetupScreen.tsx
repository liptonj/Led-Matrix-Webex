'use client';

import { Button, Card } from '@/components/ui';

export interface SetupScreenProps {
  onWebexLogin: () => void;
  isLoggingIn?: boolean;
}

export function SetupScreen({ 
  onWebexLogin,
  isLoggingIn = false,
}: SetupScreenProps) {
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold mb-4">Connect to Your Display</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Please sign in with Webex to access your LED matrix display devices.
      </p>
      
      <div className="space-y-4">
        <div className="p-4 bg-[var(--color-surface-alt)] rounded-lg">
          <Button 
            variant="primary" 
            block 
            onClick={onWebexLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? 'Logging in...' : 'Login with Webex'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
