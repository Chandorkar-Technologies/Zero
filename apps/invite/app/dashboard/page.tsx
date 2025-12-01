'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface UserData {
  email: string;
  name: string | null;
  position: number;
  referralCode: string;
  referralCount: number;
  bonusStorage: number;
  hasEarlyAccess: boolean;
  plan: 'nubo' | 'workplace';
  createdAt: string;
}

export default function DashboardPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [error, setError] = useState('');
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  // Check for email in localStorage on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('nubo_waitlist_email');
    if (savedEmail) {
      setEmail(savedEmail);
      fetchUserData(savedEmail);
    }
  }, []);

  const fetchUserData = async (emailToFetch: string) => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/status?email=${encodeURIComponent(emailToFetch)}`);
      const data = await response.json();

      if (data.success) {
        setUserData(data.user);
        localStorage.setItem('nubo_waitlist_email', emailToFetch);
      } else {
        setError(data.error || 'User not found');
        setUserData(null);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      fetchUserData(email);
    }
  };

  const referralLink = userData ? `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${userData.referralCode}` : '';

  const copyReferralLink = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setShowCopiedToast(true);
      setTimeout(() => setShowCopiedToast(false), 2000);
    }
  };

  const shareOnTwitter = () => {
    const text = `I'm #${userData?.position} on the @NuboEmail waitlist! 🇮🇳 AI-powered email & storage, Made in Bharat. Join me: ${referralLink}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareOnWhatsApp = () => {
    const text = `Hey! I'm on the Nubo waitlist - it's an AI-powered email & storage platform Made in India. Join me to get early access! ${referralLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <main className="min-h-screen bg-black">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/20 via-black to-green-900/20" />
      </div>

      {/* Header */}
      <header className="relative z-10 py-6 px-4 border-b border-white/10">
        <nav className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold">Nubo</span>
            <span className="px-2 py-0.5 text-xs bg-gradient-to-r from-orange-500 to-green-500 rounded-full font-medium">
              Made in Bharat
            </span>
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition">
            Back to Home
          </Link>
        </nav>
      </header>

      <div className="relative z-10 px-4 py-12">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Your Waitlist Status</h1>
            <p className="text-gray-400">Check your position and referral stats</p>
          </motion.div>

          {!userData ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass rounded-2xl p-8"
            >
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm text-gray-400 mb-2">
                    Enter your email to check status
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
                  />
                </div>
                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-4 bg-gradient-to-r from-orange-500 to-green-500 text-white font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50"
                >
                  {isLoading ? 'Checking...' : 'Check Status'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-sm text-gray-500">
                  Not on the waitlist yet?{' '}
                  <Link href="/" className="text-orange-400 hover:underline">
                    Join now
                  </Link>
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              {/* Position Card */}
              <div className="glass rounded-2xl p-8 text-center">
                <div className="mb-4">
                  {userData.hasEarlyAccess ? (
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/20 rounded-full text-green-400 font-medium">
                      <span className="text-lg">🎉</span>
                      Early Access Unlocked!
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/20 rounded-full text-orange-400 font-medium">
                      <span className="text-lg">⏳</span>
                      Waiting for Access
                    </span>
                  )}
                </div>

                <h2 className="text-xl text-gray-400 mb-2">
                  {userData.name ? `Hey ${userData.name}!` : 'Hey there!'}
                </h2>

                <div className="text-6xl font-bold mb-2">
                  <span className="gradient-text">#{userData.position}</span>
                </div>
                <p className="text-gray-500">Your position on the waitlist</p>

                <div className="mt-6 flex justify-center gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-400">{userData.referralCount}</div>
                    <div className="text-xs text-gray-500">Referrals</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{userData.bonusStorage}GB</div>
                    <div className="text-xs text-gray-500">Bonus Storage</div>
                  </div>
                </div>
              </div>

              {/* Referral Benefits Progress */}
              <div className="glass rounded-2xl p-6">
                <h3 className="font-bold mb-4">Referral Rewards</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${userData.referralCount >= 1 ? 'bg-green-500' : 'bg-white/10'}`}>
                      {userData.referralCount >= 1 ? '✓' : '1'}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">1 Referral</div>
                      <div className="text-sm text-gray-500">Move up 100 spots</div>
                    </div>
                    {userData.referralCount >= 1 && <span className="text-green-400 text-sm">Earned!</span>}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${userData.referralCount >= 3 ? 'bg-green-500' : 'bg-white/10'}`}>
                      {userData.referralCount >= 3 ? '✓' : '3'}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">3 Referrals</div>
                      <div className="text-sm text-gray-500">Get early access</div>
                    </div>
                    {userData.referralCount >= 3 && <span className="text-green-400 text-sm">Earned!</span>}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${userData.referralCount >= 5 ? 'bg-green-500' : 'bg-white/10'}`}>
                      {userData.referralCount >= 5 ? '✓' : '5'}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">5 Referrals</div>
                      <div className="text-sm text-gray-500">+2GB bonus storage</div>
                    </div>
                    {userData.referralCount >= 5 && <span className="text-green-400 text-sm">Earned!</span>}
                  </div>
                </div>
              </div>

              {/* Referral Link */}
              <div className="glass rounded-2xl p-6">
                <h3 className="font-bold mb-4">Your Referral Link</h3>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    readOnly
                    value={referralLink}
                    className="flex-1 px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-sm font-mono"
                  />
                  <button
                    onClick={copyReferralLink}
                    className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition text-sm"
                  >
                    Copy
                  </button>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={shareOnTwitter}
                    className="flex-1 py-3 bg-[#1DA1F2] rounded-lg font-medium hover:opacity-90 transition text-sm"
                  >
                    Share on Twitter
                  </button>
                  <button
                    onClick={shareOnWhatsApp}
                    className="flex-1 py-3 bg-[#25D366] rounded-lg font-medium hover:opacity-90 transition text-sm"
                  >
                    Share on WhatsApp
                  </button>
                </div>
              </div>

              {/* Plan Info */}
              <div className="glass rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-400">Selected Plan</div>
                    <div className="font-bold capitalize">
                      {userData.plan === 'nubo' ? 'Nubo Pro' : 'Nubo Workplace'}
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-sm ${userData.plan === 'nubo' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
                    {userData.plan === 'nubo' ? 'Individual' : 'Team'}
                  </div>
                </div>
              </div>

              {/* Check Different Email */}
              <div className="text-center">
                <button
                  onClick={() => {
                    setUserData(null);
                    localStorage.removeItem('nubo_waitlist_email');
                  }}
                  className="text-sm text-gray-500 hover:text-white transition"
                >
                  Check a different email
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 px-4 py-8 border-t border-white/10 mt-auto">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          © 2025 Nubo Technologies Pvt. Ltd. • Made with ❤️ in India
        </div>
      </footer>

      {/* Copied Toast */}
      <AnimatePresence>
        {showCopiedToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-green-500 text-white font-medium rounded-full shadow-lg"
          >
            Link copied to clipboard!
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
