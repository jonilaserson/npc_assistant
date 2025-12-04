import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Users, DollarSign, Image, MessageSquare, ArrowLeft, Eye, Loader2, TrendingUp } from 'lucide-react';

export const AdminDashboard = ({ user, onExit, onImpersonate }) => {
    const [users, setUsers] = useState([]);
    const [usageLogs, setUsageLogs] = useState([]);
    const [feedback, setFeedback] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState(null);

    // Check if current user is admin
    const isAdmin = user?.email === import.meta.env.VITE_ADMIN_EMAIL;

    useEffect(() => {
        if (!isAdmin) return;
        loadAdminData();
    }, [isAdmin]);

    const loadAdminData = async () => {
        setLoading(true);
        try {
            // Load all users
            const usersSnapshot = await getDocs(collection(db, 'all_users'));
            const usersData = usersSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Load all usage logs
            const logsSnapshot = await getDocs(
                query(collection(db, 'usage_logs'), orderBy('timestamp', 'desc'))
            );
            const logsData = logsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Load all feedback
            const feedbackSnapshot = await getDocs(
                query(collection(db, 'feedback'), orderBy('timestamp', 'desc'))
            );
            const feedbackData = feedbackSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            setUsers(usersData);
            setUsageLogs(logsData);
            setFeedback(feedbackData);
        } catch (error) {
            console.error('Error loading admin data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate stats per user
    const getUserStats = (userId) => {
        const userLogs = usageLogs.filter(log => log.userId === userId);
        const dalleCount = userLogs.filter(log => log.type === 'dalle').length;
        const geminiTTSCount = userLogs.filter(log => log.type === 'gemini_tts').length;
        const elevenLabsTTSCount = userLogs.filter(log => log.type === 'elevenlabs_tts').length;
        const chatCount = userLogs.filter(log => log.type === 'gemini_chat').length;
        const totalCost = userLogs.reduce((sum, log) => sum + (log.estimatedCost || 0), 0);

        return {
            dalleCount,
            geminiTTSCount,
            elevenLabsTTSCount,
            chatCount,
            totalCost: totalCost.toFixed(2)
        };
    };

    // Calculate overall stats
    const overallStats = {
        totalUsers: users.length,
        totalDalleImages: usageLogs.filter(log => log.type === 'dalle').length,
        totalTTSCalls: usageLogs.filter(log => log.type === 'gemini_tts' || log.type === 'elevenlabs_tts').length,
        totalCost: usageLogs.reduce((sum, log) => sum + (log.estimatedCost || 0), 0).toFixed(2),
        totalFeedback: feedback.length
    };

    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-center p-8 bg-white rounded-lg shadow-lg">
                    <h2 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h2>
                    <p className="text-gray-600">You do not have admin privileges.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
                        <p className="text-gray-600 mt-1">Monitor users, usage, and costs</p>
                    </div>
                    <button
                        onClick={onExit}
                        className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to App
                    </button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        icon={Users}
                        label="Total Users"
                        value={overallStats.totalUsers}
                        color="blue"
                    />
                    <StatCard
                        icon={Image}
                        label="DALL-E Images"
                        value={overallStats.totalDalleImages}
                        color="purple"
                    />
                    <StatCard
                        icon={MessageSquare}
                        label="TTS Calls"
                        value={overallStats.totalTTSCalls}
                        color="green"
                    />
                    <StatCard
                        icon={DollarSign}
                        label="Total Cost"
                        value={`$${overallStats.totalCost}`}
                        color="red"
                    />
                </div>

                {/* Users Table */}
                <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8">
                    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                        <h2 className="text-xl font-bold text-gray-900">Users</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Email
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Images
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        TTS Calls
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Messages
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Total Cost
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Last Seen
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {users.map(userData => {
                                    const stats = getUserStats(userData.id);
                                    return (
                                        <tr key={userData.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {userData.email}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {stats.dalleCount}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {stats.geminiTTSCount + stats.elevenLabsTTSCount}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {stats.chatCount}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                                ${stats.totalCost}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {userData.lastSeen?.toDate ? new Date(userData.lastSeen.toDate()).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <button
                                                    onClick={() => onImpersonate(userData.id, userData.email)}
                                                    className="flex items-center px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                                                >
                                                    <Eye className="w-4 h-4 mr-1" />
                                                    View as User
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Feedback Section */}
                {feedback.length > 0 && (
                    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                            <h2 className="text-xl font-bold text-gray-900">User Feedback</h2>
                        </div>
                        <div className="divide-y divide-gray-200">
                            {feedback.slice(0, 10).map(item => (
                                <div key={item.id} className="px-6 py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-900">{item.email}</p>
                                            <p className="text-sm text-gray-600 mt-1">{item.message}</p>
                                        </div>
                                        <span className="text-xs text-gray-500 ml-4">
                                            {item.timestamp?.toDate ? new Date(item.timestamp.toDate()).toLocaleDateString() : 'N/A'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Stat Card Component
const StatCard = ({ icon: Icon, label, value, color }) => {
    const colorClasses = {
        blue: 'bg-blue-100 text-blue-600',
        purple: 'bg-purple-100 text-purple-600',
        green: 'bg-green-100 text-green-600',
        red: 'bg-red-100 text-red-600'
    };

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-600">{label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
                </div>
                <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
                    <Icon className="w-6 h-6" />
                </div>
            </div>
        </div>
    );
};
