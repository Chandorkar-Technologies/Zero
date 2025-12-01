'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<'nubo' | 'workplace'>('nubo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    position?: number;
    referralCode?: string;
    referralLink?: string;
  } | null>(null);
  const [totalUsers, setTotalUsers] = useState(2847); // Start with a believable number
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  // Countdown to Dec 31, 2025
  useEffect(() => {
    const deadline = new Date('2025-12-31T23:59:59');
    const interval = setInterval(() => {
      const now = new Date();
      const diff = deadline.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Simulate growing user count
  useEffect(() => {
    const interval = setInterval(() => {
      setTotalUsers((prev) => prev + Math.floor(Math.random() * 3));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Get referral code from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      const referredBy = urlParams.get('ref');

      const response = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, plan, referredBy }),
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          success: true,
          position: data.position,
          referralCode: data.referralCode,
          referralLink: `${window.location.origin}/join/${data.referralCode}`,
        });
        setTotalUsers((prev) => prev + 1);
      } else {
        setResult({ success: false });
      }
    } catch (error) {
      console.error('Error:', error);
      setResult({ success: false });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyReferralLink = () => {
    if (result?.referralLink) {
      navigator.clipboard.writeText(result.referralLink);
      setShowCopiedToast(true);
      setTimeout(() => setShowCopiedToast(false), 2000);
    }
  };

  const shareOnTwitter = () => {
    const text = `I just joined the @NuboEmail waitlist! 🇮🇳 AI-powered email & storage, Made in Bharat. Join me and get early access: ${result?.referralLink}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareOnLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(result?.referralLink || '')}`, '_blank');
  };

  const shareOnWhatsApp = () => {
    const text = `Hey! I joined the Nubo waitlist - it's an AI-powered email & storage platform Made in India. Join me to get early access! ${result?.referralLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <main className="min-h-screen bg-black overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/20 via-black to-green-900/20" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 py-6 px-4">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">Nubo</span>
            <span className="px-2 py-0.5 text-xs bg-gradient-to-r from-orange-500 to-green-500 rounded-full font-medium">
              Made in Bharat
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#pricing" className="hover:text-white transition">Pricing</a>
            <a href="#story" className="hover:text-white transition">Our Story</a>
            <a href="/dashboard" className="px-3 py-1 bg-white/10 rounded-full hover:bg-white/20 transition">
              Check Status
            </a>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 px-4 py-12 md:py-20">
        <div className="max-w-5xl mx-auto text-center">
          {/* Countdown Banner */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-3 px-4 py-2 mb-8 rounded-full glass"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
            <span className="text-sm">
              <span className="text-orange-400 font-semibold">{10000 - totalUsers}</span> spots left
            </span>
            <span className="text-gray-500">|</span>
            <span className="text-sm font-mono">
              {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
            </span>
          </motion.div>

          {/* Main Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight"
          >
            The Future of Email
            <br />
            <span className="gradient-text">Made in Bharat</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-gray-400 mb-8 max-w-2xl mx-auto"
          >
            AI-powered email, unlimited storage, video meetings — all in one platform.
            <br className="hidden md:block" />
            <span className="text-white font-medium">Save 80% compared to Google Workspace.</span>
          </motion.p>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex justify-center gap-8 md:gap-16 mb-12"
          >
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-orange-400 counter">{totalUsers.toLocaleString()}</div>
              <div className="text-sm text-gray-500">People Waiting</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-green-400">80%</div>
              <div className="text-sm text-gray-500">Savings</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-white">100%</div>
              <div className="text-sm text-gray-500">Indian</div>
            </div>
          </motion.div>

          {/* Signup Form or Success */}
          <AnimatePresence mode="wait">
            {!result?.success ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-md mx-auto"
              >
                {/* Plan Selection */}
                <div className="flex gap-2 mb-4 p-1 bg-white/5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPlan('nubo')}
                    className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition ${
                      plan === 'nubo'
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Nubo Pro
                    <span className="block text-xs opacity-75">For Individuals</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlan('workplace')}
                    className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition ${
                      plan === 'workplace'
                        ? 'bg-gradient-to-r from-orange-500 via-white/90 to-green-500 text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Nubo Workplace
                    <span className={`block text-xs ${plan === 'workplace' ? 'opacity-60' : 'opacity-75'}`}>For Teams</span>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    type="text"
                    placeholder="Your name (optional)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
                  />
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-4 bg-gradient-to-r from-orange-500 via-white to-green-500 text-black font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50 pulse-cta"
                  >
                    {isSubmitting ? 'Joining...' : 'Get Early Access'}
                  </button>
                </form>

                <p className="mt-4 text-xs text-gray-500">
                  By joining, you agree to our Terms of Service. No spam, ever.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-lg mx-auto p-8 glass rounded-2xl"
              >
                <div className="text-5xl mb-4">🎉</div>
                <h2 className="text-2xl font-bold mb-2">You&apos;re In!</h2>
                <p className="text-gray-400 mb-6">
                  You&apos;re <span className="text-orange-400 font-bold">#{result.position}</span> on the waitlist
                </p>

                {/* Referral Section */}
                <div className="bg-white/5 rounded-xl p-4 mb-6">
                  <p className="text-sm text-gray-400 mb-2">Share your link to move up:</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={result.referralLink}
                      className="flex-1 px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-sm font-mono"
                    />
                    <button
                      onClick={copyReferralLink}
                      className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition text-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Referral Benefits */}
                <div className="grid grid-cols-3 gap-3 mb-6 text-center text-sm">
                  <div className="p-3 bg-white/5 rounded-lg">
                    <div className="text-orange-400 font-bold">1 referral</div>
                    <div className="text-gray-500">+100 spots up</div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg">
                    <div className="text-orange-400 font-bold">3 referrals</div>
                    <div className="text-gray-500">Early access</div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg">
                    <div className="text-orange-400 font-bold">5 referrals</div>
                    <div className="text-gray-500">+2GB storage</div>
                  </div>
                </div>

                {/* Social Share Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={shareOnTwitter}
                    className="flex-1 py-3 bg-[#1DA1F2] rounded-lg font-medium hover:opacity-90 transition"
                  >
                    Twitter
                  </button>
                  <button
                    onClick={shareOnLinkedIn}
                    className="flex-1 py-3 bg-[#0077B5] rounded-lg font-medium hover:opacity-90 transition"
                  >
                    LinkedIn
                  </button>
                  <button
                    onClick={shareOnWhatsApp}
                    className="flex-1 py-3 bg-[#25D366] rounded-lg font-medium hover:opacity-90 transition"
                  >
                    WhatsApp
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 px-4 py-20">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Two Products, One Mission</h2>
          <p className="text-gray-400 text-center mb-12 max-w-2xl mx-auto">
            Whether you&apos;re an individual or a growing business, Nubo has you covered.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Nubo Pro */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="p-8 rounded-2xl glass border-l-4 border-orange-500"
            >
              <div className="text-orange-400 text-sm font-semibold mb-2">For Individuals</div>
              <h3 className="text-2xl font-bold mb-4">Nubo Pro</h3>
              <ul className="space-y-3 text-gray-300">
                <li className="flex items-start gap-3">
                  <span className="text-orange-400">✓</span>
                  <span>AI-powered email with smart compose & summarization</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-orange-400">✓</span>
                  <span>50GB free storage, unlimited with Pro</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-orange-400">✓</span>
                  <span>HD video meetings up to 100 participants</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-orange-400">✓</span>
                  <span>AI productivity tools (writing, translation, code)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-orange-400">✓</span>
                  <span>Works on web, desktop & mobile</span>
                </li>
              </ul>
              <div className="mt-6 text-sm text-gray-500">
                Starting at <span className="text-white font-bold">₹99/month</span>
              </div>
            </motion.div>

            {/* Nubo Workplace */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="p-8 rounded-2xl glass border-l-4 border-green-500"
            >
              <div className="text-green-400 text-sm font-semibold mb-2">For Teams & Organizations</div>
              <h3 className="text-2xl font-bold mb-4">Nubo Workplace</h3>
              <ul className="space-y-3 text-gray-300">
                <li className="flex items-start gap-3">
                  <span className="text-green-400">✓</span>
                  <span>Custom domain email (you@yourcompany.com)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400">✓</span>
                  <span>Storage-based pricing (not per user)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400">✓</span>
                  <span>Admin console with user management</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400">✓</span>
                  <span>Team collaboration & shared drives</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400">✓</span>
                  <span>Save 80% vs Google Workspace / Microsoft 365</span>
                </li>
              </ul>
              <div className="mt-6 text-sm text-gray-500">
                Starting at <span className="text-white font-bold">₹499/100GB/month</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section id="pricing" className="relative z-10 px-4 py-20 bg-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Save 80% vs Big Tech</h2>
          <p className="text-gray-400 mb-12">Same features. Indian pricing. No lock-in.</p>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-4 px-4 text-gray-400 font-normal">Feature</th>
                  <th className="py-4 px-4 text-center">
                    <span className="gradient-text font-bold">Nubo</span>
                  </th>
                  <th className="py-4 px-4 text-center text-gray-500">Google</th>
                  <th className="py-4 px-4 text-center text-gray-500">Microsoft</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-white/5">
                  <td className="py-4 px-4 text-gray-300">100GB Storage</td>
                  <td className="py-4 px-4 text-center text-green-400 font-bold">₹499/mo</td>
                  <td className="py-4 px-4 text-center text-gray-500">₹2,500/mo</td>
                  <td className="py-4 px-4 text-center text-gray-500">₹2,800/mo</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-4 px-4 text-gray-300">Custom Domain Email</td>
                  <td className="py-4 px-4 text-center text-green-400">✓</td>
                  <td className="py-4 px-4 text-center text-gray-500">✓</td>
                  <td className="py-4 px-4 text-center text-gray-500">✓</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-4 px-4 text-gray-300">AI Features</td>
                  <td className="py-4 px-4 text-center text-green-400">Included</td>
                  <td className="py-4 px-4 text-center text-gray-500">Extra cost</td>
                  <td className="py-4 px-4 text-center text-gray-500">Extra cost</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-4 px-4 text-gray-300">Video Meetings</td>
                  <td className="py-4 px-4 text-center text-green-400">Unlimited</td>
                  <td className="py-4 px-4 text-center text-gray-500">Limited</td>
                  <td className="py-4 px-4 text-center text-gray-500">Limited</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 text-gray-300">Data Location</td>
                  <td className="py-4 px-4 text-center text-green-400">🇮🇳 India</td>
                  <td className="py-4 px-4 text-center text-gray-500">USA</td>
                  <td className="py-4 px-4 text-center text-gray-500">USA</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Made in Bharat Story */}
      <section id="story" className="relative z-10 px-4 py-20">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500/20 via-white/20 to-green-500/20 rounded-full mb-6">
              <span className="text-2xl">🇮🇳</span>
              <span className="font-semibold">Proudly Made in Bharat</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Why We&apos;re Building Nubo
            </h2>
          </motion.div>

          <div className="prose prose-invert max-w-none">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="glass rounded-2xl p-8 mb-8"
            >
              <p className="text-lg text-gray-300 leading-relaxed mb-6">
                India sends over <span className="text-orange-400 font-bold">300 billion emails</span> every year.
                Yet, we rely entirely on American companies for our most critical business communications.
              </p>
              <p className="text-lg text-gray-300 leading-relaxed mb-6">
                Every email you send through Gmail or Outlook travels through servers in the US.
                Your business data, your personal conversations, your trade secrets — all stored on foreign soil,
                subject to foreign laws.
              </p>
              <p className="text-lg text-gray-300 leading-relaxed">
                <span className="text-white font-bold">Nubo changes that.</span> We&apos;re building India&apos;s first
                world-class email and productivity platform. Your data stays in India. Your money stays in India.
                Your trust stays with a company that answers to Indian laws.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid md:grid-cols-3 gap-6"
            >
              <div className="glass rounded-xl p-6 text-center">
                <div className="text-3xl mb-3">🏛️</div>
                <h3 className="font-bold mb-2">Data Sovereignty</h3>
                <p className="text-sm text-gray-400">Your data never leaves Indian borders</p>
              </div>
              <div className="glass rounded-xl p-6 text-center">
                <div className="text-3xl mb-3">💰</div>
                <h3 className="font-bold mb-2">Fair Pricing</h3>
                <p className="text-sm text-gray-400">Indian pricing for Indian businesses</p>
              </div>
              <div className="glass rounded-xl p-6 text-center">
                <div className="text-3xl mb-3">🚀</div>
                <h3 className="font-bold mb-2">Built for Scale</h3>
                <p className="text-sm text-gray-400">From startups to enterprises</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-4 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Join the <span className="gradient-text">Revolution</span>
          </h2>
          <p className="text-gray-400 mb-8">
            Be among the first 10,000 to experience the future of productivity.
          </p>

          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-block px-8 py-4 bg-gradient-to-r from-orange-500 via-white to-green-500 text-black font-bold rounded-xl hover:opacity-90 transition pulse-cta"
          >
            Get Early Access Now
          </a>

          <p className="mt-8 text-sm text-gray-500">
            Launching January 1, 2026 • Built with ❤️ in India
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-4 py-8 border-t border-white/10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="font-bold">Nubo</span>
            <span className="text-sm text-gray-500">© 2025 Nubo Technologies Pvt. Ltd.</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="/privacy" className="hover:text-white transition">Privacy</a>
            <a href="/terms" className="hover:text-white transition">Terms</a>
            <a href="mailto:hello@nubo.email" className="hover:text-white transition">Contact</a>
          </div>
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
