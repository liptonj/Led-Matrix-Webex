'use client';

import { getSupabase } from '@/lib/supabase';
import { getSession, isAdmin, signOut } from '@/lib/supabase/auth';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface UserProfile {
  email: string;
  display_name?: string;
  avatar_url?: string;
  role: string;
}

export default function UserShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const isLoginPage = pathname === '/user/login' || pathname === '/user/callback';

  useEffect(() => {
    // Don't check auth on login/callback pages
    if (isLoginPage) {
      setLoading(false);
      return;
    }

    async function checkAuth() {
      try {
        const { data: { session } } = await getSession();
        
        if (!session) {
          router.push('/login');
          return;
        }

        // Fetch user profile
        const supabase = await getSupabase();
        const { data: profileData, error } = await supabase
          .schema('display')
          .from('user_profiles')
          .select('email, display_name, avatar_url, role')
          .eq('user_id', session.user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching profile:', error);
        }

        if (profileData) {
          setProfile(profileData);
        } else {
          // Fallback to auth user email if profile doesn't exist
          setProfile({
            email: session.user.email || '',
            role: 'user'
          });
        }

        const adminStatus = await isAdmin();
        setIsAdminUser(adminStatus);
        setLoading(false);
      } catch (err) {
        console.error('Auth check error:', err);
        router.push('/login');
      }
    }

    checkAuth();
  }, [router, isLoginPage]);

  // Don't render shell on login/callback pages
  if (isLoginPage) {
    return <>{children}</>;
  }

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/user" className="text-xl font-bold text-gray-900 dark:text-white">
                LED Display
              </Link>
              <div className="hidden md:flex items-center space-x-4">
                <Link 
                  href="/user" 
                  className={`text-sm font-medium ${
                    pathname === '/user' 
                      ? 'text-blue-600 dark:text-blue-400' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/user/install" 
                  className={`text-sm font-medium ${
                    pathname === '/user/install' 
                      ? 'text-blue-600 dark:text-blue-400' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Install Device
                </Link>
                <Link 
                  href="/user/approve-device" 
                  className={`text-sm font-medium ${
                    pathname === '/user/approve-device' 
                      ? 'text-blue-600 dark:text-blue-400' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
          >
            Approve Device
          </Link>
          {isAdminUser && (
            <Link 
              href="/admin" 
              className="block px-3 py-2 rounded-md text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              Admin Portal
            </Link>
          )}
          <Link 
            href="/" 
            className="block px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Main Site
          </Link>
        </div>
      </div>

            <div className="flex items-center space-x-4">
              <Link 
                href="/" 
                className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Main Site
              </Link>
              
              {isAdminUser && (
                <Link 
                  href="/admin" 
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
                >
                  Admin Portal
                </Link>
              )}
              
              <div className="flex items-center space-x-2">
                {profile?.avatar_url && (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-sm text-gray-700 dark:text-gray-300 hidden sm:inline">
                  {profile?.display_name || profile?.email}
                </span>
              </div>

              <button
                onClick={handleSignOut}
                className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-2 space-y-1">
          <Link 
            href="/user" 
            className={`block px-3 py-2 rounded-md text-sm font-medium ${
              pathname === '/user' 
                ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-200' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Dashboard
          </Link>
          <Link 
            href="/user/install" 
            className={`block px-3 py-2 rounded-md text-sm font-medium ${
              pathname === '/user/install' 
                ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-200' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Install Device
          </Link>
          <Link 
            href="/user/approve-device" 
            className={`block px-3 py-2 rounded-md text-sm font-medium ${
              pathname === '/user/approve-device' 
                ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-200' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Approve Device
          </Link>
          
          {/* Mobile - Additional Links */}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700 mt-2">
            <Link 
              href="/" 
              className="block px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Main Site
            </Link>
            {isAdminUser && (
              <Link 
                href="/admin" 
                className="block px-3 py-2 rounded-md text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900"
              >
                Admin Portal
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
