'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface WaitlistUser {
  id: string;
  email: string;
  name: string | null;
  referralCode: string;
  position: number;
  referralCount: number;
  bonusStorage: number;
  hasEarlyAccess: boolean;
  plan: 'nubo' | 'workplace';
  createdAt: string;
  invitedAt: string | null;
}

interface Stats {
  total: number;
  nubo: number;
  workplace: number;
  earlyAccess: number;
  invited: number;
  todaySignups: number;
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<WaitlistUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPlan, setFilterPlan] = useState<'all' | 'nubo' | 'workplace'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'early' | 'invited'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Check if already authenticated
  useEffect(() => {
    const token = localStorage.getItem('nubo_admin_token');
    if (token) {
      verifyToken(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  const verifyToken = async (token: string) => {
    try {
      const response = await fetch('/api/admin/verify', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setIsAuthenticated(true);
        fetchData(token);
      } else {
        localStorage.removeItem('nubo_admin_token');
      }
    } catch {
      localStorage.removeItem('nubo_admin_token');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('nubo_admin_token', data.token);
        setIsAuthenticated(true);
        fetchData(data.token);
      } else {
        setAuthError(data.error || 'Invalid password');
      }
    } catch {
      setAuthError('Something went wrong');
    }
  };

  const fetchData = useCallback(async (token: string) => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin/users?page=${page}&search=${searchQuery}&plan=${filterPlan}&status=${filterStatus}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const statsData = await statsRes.json();
      const usersData = await usersRes.json();

      if (statsData.success) setStats(statsData.stats);
      if (usersData.success) {
        setUsers(usersData.users);
        setTotalPages(usersData.totalPages);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [page, searchQuery, filterPlan, filterStatus]);

  useEffect(() => {
    if (isAuthenticated) {
      const token = localStorage.getItem('nubo_admin_token');
      if (token) fetchData(token);
    }
  }, [page, searchQuery, filterPlan, filterStatus, isAuthenticated, fetchData]);

  const markAsInvited = async (userId: string) => {
    const token = localStorage.getItem('nubo_admin_token');
    try {
      await fetch('/api/admin/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (token) fetchData(token);
    } catch (error) {
      console.error('Error inviting user:', error);
    }
  };

  const exportCSV = async () => {
    const token = localStorage.getItem('nubo_admin_token');
    try {
      const response = await fetch('/api/admin/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nubo-waitlist-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (error) {
      console.error('Error exporting:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nubo_admin_token');
    setIsAuthenticated(false);
    setStats(null);
    setUsers([]);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">Admin Dashboard</h1>
            <p className="text-gray-500">Enter password to access</p>
          </div>

          <form onSubmit={handleLogin} className="glass rounded-2xl p-8 space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm text-gray-400 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
              />
            </div>
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-green-500 text-white font-bold rounded-xl hover:opacity-90 transition"
            >
              Login
            </button>
          </form>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Nubo Admin</h1>
            <p className="text-sm text-gray-500">Waitlist Management</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-white">{stats.total}</div>
              <div className="text-sm text-gray-500">Total Signups</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-orange-400">{stats.nubo}</div>
              <div className="text-sm text-gray-500">Nubo Pro</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-green-400">{stats.workplace}</div>
              <div className="text-sm text-gray-500">Workplace</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-purple-400">{stats.earlyAccess}</div>
              <div className="text-sm text-gray-500">Early Access</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-blue-400">{stats.invited}</div>
              <div className="text-sm text-gray-500">Invited</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-3xl font-bold text-yellow-400">{stats.todaySignups}</div>
              <div className="text-sm text-gray-500">Today</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="glass rounded-xl p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by email or referral code..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterPlan}
                onChange={(e) => {
                  setFilterPlan(e.target.value as 'all' | 'nubo' | 'workplace');
                  setPage(1);
                }}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none"
              >
                <option value="all">All Plans</option>
                <option value="nubo">Nubo Pro</option>
                <option value="workplace">Workplace</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value as 'all' | 'early' | 'invited');
                  setPage(1);
                }}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="early">Early Access</option>
                <option value="invited">Invited</option>
              </select>
              <button
                onClick={exportCSV}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">#</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Email</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Name</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Plan</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Referrals</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Code</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Status</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Joined</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-normal text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-4 text-sm">{user.position}</td>
                    <td className="py-3 px-4 text-sm">{user.email}</td>
                    <td className="py-3 px-4 text-sm text-gray-400">{user.name || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        user.plan === 'nubo' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                      }`}>
                        {user.plan === 'nubo' ? 'Pro' : 'Workplace'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">{user.referralCount}</td>
                    <td className="py-3 px-4 text-sm font-mono text-gray-400">{user.referralCode}</td>
                    <td className="py-3 px-4">
                      {user.invitedAt ? (
                        <span className="px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-400">Invited</span>
                      ) : user.hasEarlyAccess ? (
                        <span className="px-2 py-1 rounded-full text-xs bg-purple-500/20 text-purple-400">Early Access</span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs bg-gray-500/20 text-gray-400">Waiting</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      {!user.invitedAt && (
                        <button
                          onClick={() => markAsInvited(user.id)}
                          className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition"
                        >
                          Mark Invited
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <div className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-white/10 rounded hover:bg-white/20 transition disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm bg-white/10 rounded hover:bg-white/20 transition disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
