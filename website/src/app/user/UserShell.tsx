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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isLoginPage = pathname === '/user/login';

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
            {/* Left side: Hamburger (mobile) + Logo + Desktop nav */}
            <div className="flex items-center">
              {/* Mobile hamburger menu button - moved to left */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-3 -ml-2 mr-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 touch-manipulation"
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              <Link href="/user" className="text-xl font-bold text-gray-900 dark:text-white">
                LED Display
              </Link>

              {/* Desktop Navigation Links */}
              <div className="hidden md:flex items-center space-x-1 ml-8">
                <Link 
                  href="/user" 
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === '/user' 
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/user/install" 
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === '/user/install' 
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Install Device
                </Link>
                <Link 
                  href="/user/approve-device" 
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === '/user/approve-device' 
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Approve Device
                </Link>
                <Link 
                  href="/user/support" 
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === '/user/support' || pathname?.startsWith('/user/support')
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Support
                </Link>
              </div>
            </div>

            {/* Right side: Desktop links + User info */}
            <div className="flex items-center space-x-2 md:space-x-4">
              {/* Desktop-only links */}
              <Link 
                href="/" 
                className="hidden md:block px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors"
              >
                Main Site
              </Link>
              
              {isAdminUser && (
                <Link 
                  href="/admin" 
                  className="hidden md:block px-3 py-2 rounded-lg text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-sm font-medium transition-colors"
                >
                  Admin Portal
                </Link>
              )}
              
              {/* User avatar/info */}
              <div className="flex items-center space-x-2">
                {profile?.avatar_url && (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full ring-2 ring-gray-200 dark:ring-gray-700"
                  />
                )}
                <span className="text-sm text-gray-700 dark:text-gray-300 hidden md:inline max-w-[120px] truncate">
                  {profile?.display_name || profile?.email}
                </span>
              </div>

              {/* Desktop Sign Out */}
              <button
                onClick={handleSignOut}
                className="hidden md:block px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu (collapsible with animation) */}
        <div 
          className={`md:hidden border-t border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-300 ease-in-out ${
            mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="px-4 py-3 space-y-1">
            {/* User info for mobile */}
            <div className="flex items-center space-x-3 px-3 py-3 mb-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              {profile?.avatar_url && (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="w-10 h-10 rounded-full ring-2 ring-gray-200 dark:ring-gray-600"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {profile?.display_name || 'User'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {profile?.email}
                </p>
              </div>
            </div>

            {/* Navigation links with larger touch targets */}
            <Link 
              href="/user" 
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-3 rounded-lg text-base font-medium touch-manipulation active:scale-[0.98] transition-all ${
                pathname === '/user' 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-200' 
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600'
              }`}
            >
              Dashboard
            </Link>
            <Link 
              href="/user/install" 
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-3 rounded-lg text-base font-medium touch-manipulation active:scale-[0.98] transition-all ${
                pathname === '/user/install' 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-200' 
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600'
              }`}
            >
              Install Device
            </Link>
            <Link 
              href="/user/approve-device" 
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-3 rounded-lg text-base font-medium touch-manipulation active:scale-[0.98] transition-all ${
                pathname === '/user/approve-device' 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-200' 
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600'
              }`}
            >
              Approve Device
            </Link>
            <Link 
              href="/user/support" 
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-3 rounded-lg text-base font-medium touch-manipulation active:scale-[0.98] transition-all ${
                pathname === '/user/support' || pathname?.startsWith('/user/support')
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-200' 
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600'
              }`}
            >
              Support
            </Link>
            
            {/* Mobile - Additional Links */}
            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
              <Link 
                href="/" 
                onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-3 rounded-lg text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 touch-manipulation active:scale-[0.98] transition-all"
              >
                Main Site
              </Link>
              {isAdminUser && (
                <Link 
                  href="/admin" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-lg text-base font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 active:bg-blue-100 dark:active:bg-blue-900/50 touch-manipulation active:scale-[0.98] transition-all"
                >
                  Admin Portal
                </Link>
              )}
              
              {/* Sign Out moved to mobile menu */}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="w-full text-left px-4 py-3 rounded-lg text-base font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 active:bg-red-100 dark:active:bg-red-900/30 touch-manipulation active:scale-[0.98] transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
