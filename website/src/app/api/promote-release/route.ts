import { getSession } from '@/lib/supabase/auth';
import { getCurrentUserProfile } from '@/lib/supabase/users';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const sessionResult = await getSession();
    if (!sessionResult.data.session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify user is an admin
    const profile = await getCurrentUserProfile();
    if (!profile || profile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const { version, rolloutPercentage = 100 } = await request.json();

    if (!version) {
      return NextResponse.json(
        { error: 'Version is required' },
        { status: 400 }
      );
    }

    // Validate version format
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(version)) {
      return NextResponse.json(
        { error: 'Invalid version format' },
        { status: 400 }
      );
    }

    // Get GitHub configuration from environment
    const githubRepo = process.env.GITHUB_REPO;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubRepo || !githubToken) {
      console.error('Missing GITHUB_REPO or GITHUB_TOKEN environment variables');
      return NextResponse.json(
        { error: 'GitHub integration not configured' },
        { status: 500 }
      );
    }

    // Trigger the GitHub workflow
    const response = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/promote-to-production.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            version: version,
            rollout_percentage: String(rolloutPercentage),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitHub API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to trigger workflow: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Promotion workflow triggered for version ${version}`,
    });
  } catch (error) {
    console.error('Promote release error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
