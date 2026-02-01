import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost/ws';

console.log('Runtime endpoints:', { API_URL, WS_URL });

function App() {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [currentView, setCurrentView] = useState('devices');
    const [notifications, setNotifications] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [devices, setDevices] = useState([]);
    const [automations, setAutomations] = useState([]);
    const wsRef = useRef(null);
    const notificationRef = useRef(null);

    // WebSocket connection for real-time updates
    useEffect(() => {
        if (user && !wsRef.current) {
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                console.log('WebSocket connected');
                ws.send(JSON.stringify({
                    type: 'authenticate',
                    userId: user.id
                }));
            };

            ws.onmessage = (event) => {
                const notification = JSON.parse(event.data);
                console.log('Received notification:', notification);

                // Add to notifications list
                setNotifications(prev => [notification, ...prev].slice(0, 20));

                // Handle real-time updates
                if (notification.type === 'device.state_changed' ||
                    notification.type === 'device.added' ||
                    notification.type === 'device.removed') {
                    loadDevices();
                }

                if (notification.type === 'automation.executed' ||
                    notification.type === 'automation.created') {
                    loadAutomations();
                }

                // Show browser notification
                if (Notification.permission === 'granted') {
                    new Notification('Smart Home Alert', {
                        body: notification.message,
                        icon: '/home-icon.png'
                    });
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                wsRef.current = null;
            };

            wsRef.current = ws;
        }

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [user]);

    // Request notification permission
    useEffect(() => {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Check authentication on mount
    useEffect(() => {
        if (token) {
            fetch(`${API_URL}/api/profile`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
                .then(res => res.json())
                .then(data => {
                    if (data.user) {
                        setUser(data.user);
                    } else {
                        localStorage.removeItem('token');
                        setToken(null);
                    }
                })
                .catch(() => {
                    localStorage.removeItem('token');
                    setToken(null);
                });
        }
    }, [token]);

    // Load devices and automations when user logs in
    useEffect(() => {
        if (user && token) {
            loadDevices();
            loadAutomations();
        }
    }, [user, token]);

    // Click outside to close notifications
    useEffect(() => {
        function handleClickOutside(event) {
            if (notificationRef.current && !notificationRef.current.contains(event.target)) {
                setShowNotifications(false);
            }
        }

        if (showNotifications) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showNotifications]);

    const loadDevices = async () => {
        try {
            const response = await fetch(`${API_URL}/api/devices`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            setDevices(data.devices || []);
        } catch (error) {
            console.error('Load devices error:', error);
        }
    };

    const loadAutomations = async () => {
        try {
            const response = await fetch(`${API_URL}/api/automations`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            setAutomations(data.automations || []);
        } catch (error) {
            console.error('Load automations error:', error);
        }
    };

    const handleLogin = async (email, password) => {
        try {
            const response = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                setToken(data.token);
                setUser(data.user);
                localStorage.setItem('token', data.token);
            } else {
                alert(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed. Please try again.');
        }
    };

    const handleRegister = async (email, password, name) => {
        try {
            const response = await fetch(`${API_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });

            const data = await response.json();

            if (response.ok) {
                setToken(data.token);
                setUser(data.user);
                localStorage.setItem('token', data.token);
            } else {
                alert(data.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Registration failed. Please try again.');
        }
    };

    const handleLogout = () => {
        setUser(null);
        setToken(null);
        setDevices([]);
        setAutomations([]);
        setNotifications([]);
        localStorage.removeItem('token');
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    };

    const clearNotifications = () => {
        setNotifications([]);
    };

    const unreadCount = notifications.length;

    if (!user) {
        return <AuthForm onLogin={handleLogin} onRegister={handleRegister} />;
    }

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <h1>🏠 Smart Home</h1>
                </div>
                <div className="header-right">
                    <div className="notification-bell-container" ref={notificationRef}>
                        <button
                            className="notification-bell"
                            onClick={() => setShowNotifications(!showNotifications)}
                            title="Notifications"
                        >
                            🔔
                            {unreadCount > 0 && (
                                <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                            )}
                        </button>

                        {showNotifications && (
                            <div className="notification-dropdown">
                                <div className="notification-header">
                                    <h3>Notifications</h3>
                                    {notifications.length > 0 && (
                                        <button
                                            className="clear-notifications"
                                            onClick={clearNotifications}
                                        >
                                            Clear all
                                        </button>
                                    )}
                                </div>
                                <div className="notification-list">
                                    {notifications.length === 0 ? (
                                        <div className="no-notifications">
                                            <p>No notifications</p>
                                        </div>
                                    ) : (
                                        notifications.map((notif, idx) => (
                                            <div key={idx} className={`notification-item ${notif.type}`}>
                                                <span className="notification-icon">
                                                    {getNotificationIcon(notif.type)}
                                                </span>
                                                <div className="notification-content">
                                                    <p className="notification-message">{notif.message}</p>
                                                    <span className="notification-time">
                                                        {formatNotificationTime(notif.timestamp)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="user-info">
                        <span>{user.name}</span>
                        <button onClick={handleLogout} className="btn-logout">Logout</button>
                    </div>
                </div>
            </header>

            <nav className="navigation">
                <button
                    className={currentView === 'devices' ? 'active' : ''}
                    onClick={() => setCurrentView('devices')}
                >
                    💡 Devices
                </button>
                <button
                    className={currentView === 'automations' ? 'active' : ''}
                    onClick={() => setCurrentView('automations')}
                >
                    ⚡ Automations
                </button>
                <button
                    className={currentView === 'dashboard' ? 'active' : ''}
                    onClick={() => setCurrentView('dashboard')}
                >
                    📊 Dashboard
                </button>
            </nav>

            <main className="main-content">
                {currentView === 'devices' && (
                    <DevicesMFE
                        token={token}
                        userId={user.id}
                        devices={devices}
                        onDevicesChange={loadDevices}
                    />
                )}
                {currentView === 'automations' && (
                    <AutomationsMFE
                        token={token}
                        userId={user.id}
                        automations={automations}
                        devices={devices}
                        onAutomationsChange={loadAutomations}
                    />
                )}
                {currentView === 'dashboard' && (
                    <DashboardMFE
                        token={token}
                        devices={devices}
                        automations={automations}
                    />
                )}
            </main>
        </div>
    );
}

function getNotificationIcon(type) {
    const icons = {
        'device.state_changed': '💡',
        'motion.detected': '🚨',
        'automation.executed': '⚡',
        'security.alert': '🔒',
        'device.added': '➕',
        'device.removed': '➖',
        'device.offline': '⚠️'
    };
    return icons[type] || '🔔';
}

function formatNotificationTime(timestamp) {
    if (!timestamp) return 'Just now';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

// Authentication Form Component
function AuthForm({ onLogin, onRegister }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isLogin) {
            onLogin(email, password);
        } else {
            onRegister(email, password, name);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <h1>🏠 Smart Home</h1>
                <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>

                <form onSubmit={handleSubmit}>
                    {!isLogin && (
                        <input
                            type="text"
                            placeholder="Full Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password (min 6 characters)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength="6"
                    />
                    <button type="submit" className="btn-primary">
                        {isLogin ? 'Sign In' : 'Create Account'}
                    </button>
                </form>

                <p className="auth-toggle">
                    {isLogin ? "Don't have an account? " : 'Already have an account? '}
                    <span onClick={() => setIsLogin(!isLogin)}>
                        {isLogin ? 'Sign up' : 'Sign in'}
                    </span>
                </p>
            </div>
        </div>
    );
}

// Devices Micro Frontend
function DevicesMFE({ token, userId, devices, onDevicesChange }) {
    const [showForm, setShowForm] = useState(false);
    const [editingDevice, setEditingDevice] = useState(null);
    const [loading, setLoading] = useState(false);

    const toggleDevice = async (device) => {
        let newState = { ...device.state };

        if (device.type === 'light') {
            newState.on = !device.state.on;
        } else if (device.type === 'thermostat') {
            newState.temperature = device.state.temperature === 22 ? 25 : 22;
        } else if (device.type === 'lock') {
            newState.locked = !device.state.locked;
        } else if (device.type === 'camera') {
            newState.recording = !device.state.recording;
        } else if (device.type === 'sprinkler') {
            newState.active = !device.state.active;
        }

        try {
            const response = await fetch(`${API_URL}/api/devices/${device.id}/state`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ state: newState })
            });

            if (response.ok) {
                onDevicesChange();
            } else {
                alert('Failed to update device state');
            }
        } catch (error) {
            console.error('Toggle device error:', error);
            alert('Failed to update device');
        }
    };

    const deleteDevice = async (deviceId) => {
        if (!window.confirm('Are you sure you want to delete this device? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/devices/${deviceId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                onDevicesChange();
            } else {
                alert('Failed to delete device');
            }
        } catch (error) {
            console.error('Delete device error:', error);
            alert('Failed to delete device');
        }
    };

    return (
        <div className="devices">
            <div className="devices-header">
                <h2>My Devices</h2>
                <button
                    className="btn-primary"
                    onClick={() => {
                        setEditingDevice(null);
                        setShowForm(true);
                    }}
                >
                    + Add Device
                </button>
            </div>

            {showForm && (
                <DeviceForm
                    token={token}
                    device={editingDevice}
                    onSave={() => {
                        onDevicesChange();
                        setShowForm(false);
                        setEditingDevice(null);
                    }}
                    onCancel={() => {
                        setShowForm(false);
                        setEditingDevice(null);
                    }}
                />
            )}

            <div className="device-grid">
                {devices.map(device => (
                    <DeviceCard
                        key={device.id}
                        device={device}
                        onToggle={toggleDevice}
                        onEdit={(device) => {
                            setEditingDevice(device);
                            setShowForm(true);
                        }}
                        onDelete={deleteDevice}
                    />
                ))}
                {devices.length === 0 && (
                    <div className="empty-state">
                        <p>No devices yet. Click "Add Device" to get started!</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function DeviceForm({ token, device, onSave, onCancel }) {
    const [name, setName] = useState(device?.name || '');
    const [type, setType] = useState(device?.type || 'light');
    const [room, setRoom] = useState(device?.room || '');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const url = device
                ? `${API_URL}/api/devices/${device.id}`
                : `${API_URL}/api/devices`;

            const method = device ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, type, room, home_id: 1 })
            });

            if (response.ok) {
                onSave();
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to save device');
            }
        } catch (error) {
            console.error('Save device error:', error);
            alert('Failed to save device');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form className="device-form" onSubmit={handleSubmit}>
            <h3>{device ? 'Edit Device' : 'Add New Device'}</h3>

            <div className="form-group">
                <label>Device Name *</label>
                <input
                    type="text"
                    placeholder="e.g., Living Room Light"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>

            <div className="form-group">
                <label>Device Type *</label>
                <select value={type} onChange={(e) => setType(e.target.value)} required disabled={!!device}>
                    <option value="light">💡 Light</option>
                    <option value="thermostat">🌡️ Thermostat</option>
                    <option value="lock">🔒 Lock</option>
                    <option value="camera">📷 Camera</option>
                    <option value="sprinkler">💧 Sprinkler</option>
                </select>
            </div>

            <div className="form-group">
                <label>Room</label>
                <input
                    type="text"
                    placeholder="e.g., Living Room, Kitchen, Bedroom"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                />
            </div>

            <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : (device ? 'Update Device' : 'Add Device')}
                </button>
                <button type="button" className="btn-secondary" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </form>
    );
}

function DeviceCard({ device, onToggle, onEdit, onDelete }) {
    const getDeviceIcon = (type) => {
        const icons = {
            light: '💡',
            thermostat: '🌡️',
            lock: '🔒',
            camera: '📷',
            sprinkler: '💧'
        };
        return icons[type] || '📱';
    };

    const getDeviceState = () => {
        if (device.type === 'light') {
            return device.state.on ? 'ON' : 'OFF';
        } else if (device.type === 'thermostat') {
            return `${device.state.temperature}°C`;
        } else if (device.type === 'lock') {
            return device.state.locked ? 'LOCKED' : 'UNLOCKED';
        } else if (device.type === 'camera') {
            return device.state.recording ? 'RECORDING' : 'IDLE';
        } else if (device.type === 'sprinkler') {
            return device.state.active ? 'ACTIVE' : 'OFF';
        }
        return 'UNKNOWN';
    };

    const isActive = () => {
        return device.state.on || device.state.recording || device.state.active || !device.state.locked;
    };

    return (
        <div className={`device-card ${isActive() ? 'active' : ''}`}>
            <div className="device-icon">{getDeviceIcon(device.type)}</div>
            <div className="device-info">
                <h3>{device.name}</h3>
                <p className="device-room">{device.room || 'Unassigned'}</p>
                <p className={`device-status online`}>
                    🟢 Ready
                </p>
            </div>
            <div className="device-controls">
                <span className="device-state">{getDeviceState()}</span>
                <div className="device-buttons">
                    <button
                        className="btn-toggle"
                        onClick={() => onToggle(device)}
                        title="Toggle device state"
                    >
                        Toggle
                    </button>
                    <button
                        className="btn-edit"
                        onClick={() => onEdit(device)}
                        title="Edit device"
                    >
                        Edit
                    </button>
                    <button
                        className="btn-delete"
                        onClick={() => onDelete(device.id)}
                        title="Delete device"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

// Automations Micro Frontend
function AutomationsMFE({ token, userId, automations, devices, onAutomationsChange }) {
    const [showForm, setShowForm] = useState(false);
    const [editingAutomation, setEditingAutomation] = useState(null);

    const executeAutomation = async (id) => {
        try {
            const response = await fetch(`${API_URL}/api/automations/${id}/execute`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                alert('Automation executed successfully!');
                onAutomationsChange();
            } else {
                alert('Failed to execute automation');
            }
        } catch (error) {
            console.error('Execute error:', error);
            alert('Failed to execute automation');
        }
    };

    const toggleAutomation = async (id) => {
        try {
            const response = await fetch(`${API_URL}/api/automations/${id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                onAutomationsChange();
            } else {
                alert('Failed to toggle automation');
            }
        } catch (error) {
            console.error('Toggle error:', error);
            alert('Failed to toggle automation');
        }
    };

    const deleteAutomation = async (id) => {
        if (!window.confirm('Are you sure you want to delete this automation? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/automations/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                onAutomationsChange();
            } else {
                alert('Failed to delete automation');
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Failed to delete automation');
        }
    };

    return (
        <div className="automations">
            <div className="automations-header">
                <h2>Automations</h2>
                <button
                    className="btn-primary"
                    onClick={() => {
                        setEditingAutomation(null);
                        setShowForm(true);
                    }}
                >
                    + New Automation
                </button>
            </div>

            {showForm && (
                <AutomationForm
                    token={token}
                    devices={devices}
                    automation={editingAutomation}
                    onSave={() => {
                        onAutomationsChange();
                        setShowForm(false);
                        setEditingAutomation(null);
                    }}
                    onCancel={() => {
                        setShowForm(false);
                        setEditingAutomation(null);
                    }}
                />
            )}

            <div className="automation-list">
                {automations.map(auto => (
                    <div key={auto._id} className="automation-card">
                        <div className="automation-header">
                            <h3>{auto.name}</h3>
                            <span className={`badge ${auto.enabled ? 'enabled' : 'disabled'}`}>
                                {auto.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        {auto.description && (
                            <p className="automation-description">{auto.description}</p>
                        )}
                        <p className="automation-trigger">
                            Trigger: {auto.trigger.type}
                        </p>
                        <p className="automation-actions">
                            Actions: {auto.actions.length} device(s)
                        </p>
                        {auto.lastExecuted && (
                            <p className="automation-last">
                                Last executed: {new Date(auto.lastExecuted).toLocaleString()}
                            </p>
                        )}
                        <div className="automation-buttons">
                            <button
                                className="btn-execute"
                                onClick={() => executeAutomation(auto._id)}
                                title="Execute automation now"
                            >
                                Execute
                            </button>
                            <button
                                className="btn-toggle"
                                onClick={() => toggleAutomation(auto._id)}
                                title={auto.enabled ? 'Disable automation' : 'Enable automation'}
                            >
                                {auto.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                                className="btn-edit"
                                onClick={() => {
                                    setEditingAutomation(auto);
                                    setShowForm(true);
                                }}
                                title="Edit automation"
                            >
                                Edit
                            </button>
                            <button
                                className="btn-delete"
                                onClick={() => deleteAutomation(auto._id)}
                                title="Delete automation"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
                {automations.length === 0 && (
                    <div className="empty-state">
                        <p>No automations yet. Click "New Automation" to create your first automation!</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function AutomationForm({ token, devices, automation, onSave, onCancel }) {
    const [name, setName] = useState(automation?.name || '');
    const [description, setDescription] = useState(automation?.description || '');
    const [triggerType, setTriggerType] = useState(automation?.trigger?.type || 'time');
    const [selectedDevice, setSelectedDevice] = useState(automation?.actions?.[0]?.deviceId?.toString() || '');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const url = automation
                ? `${API_URL}/api/automations/${automation._id}`
                : `${API_URL}/api/automations`;

            const method = automation ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name,
                    description,
                    trigger: { type: triggerType, conditions: {} },
                    actions: selectedDevice ? [{
                        deviceId: parseInt(selectedDevice),
                        state: { on: true }
                    }] : []
                })
            });

            if (response.ok) {
                onSave();
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to save automation');
            }
        } catch (error) {
            console.error('Save automation error:', error);
            alert('Failed to save automation');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form className="automation-form" onSubmit={handleSubmit}>
            <h3>{automation ? 'Edit Automation' : 'Create New Automation'}</h3>

            <div className="form-group">
                <label>Name *</label>
                <input
                    type="text"
                    placeholder="e.g., Evening Lights"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    placeholder="What does this automation do?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows="3"
                />
            </div>

            <div className="form-group">
                <label>Trigger Type *</label>
                <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} required>
                    <option value="time">⏰ Time-based</option>
                    <option value="device">💡 Device-based</option>
                    <option value="sensor">📡 Sensor-based</option>
                </select>
            </div>

            <div className="form-group">
                <label>Device to Control</label>
                <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
                    <option value="">Select a device</option>
                    {devices.map(device => (
                        <option key={device.id} value={device.id}>
                            {device.name} ({device.type})
                        </option>
                    ))}
                </select>
            </div>

            <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : (automation ? 'Update Automation' : 'Create Automation')}
                </button>
                <button type="button" className="btn-secondary" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </form>
    );
}

// Dashboard Micro Frontend
function DashboardMFE({ token, devices, automations }) {
    const stats = {
        total: devices.length,
        online: devices.length, // All devices are considered online now
        offline: 0,
        active: devices.filter(d => d.state.on || d.state.active || d.state.recording).length
    };

    const devicesByRoom = devices.reduce((acc, device) => {
        const room = device.room || 'Unassigned';
        if (!acc[room]) {
            acc[room] = [];
        }
        acc[room].push(device);
        return acc;
    }, {});

    return (
        <div className="dashboard">
            <h2>Dashboard Overview</h2>

            <div className="stats-grid">
                <div className="stat-card">
                    <h3>Total Devices</h3>
                    <p className="stat-value">{stats.total}</p>
                </div>
                <div className="stat-card online">
                    <h3>Ready</h3>
                    <p className="stat-value">{stats.online}</p>
                </div>
                <div className="stat-card active">
                    <h3>Active</h3>
                    <p className="stat-value">{stats.active}</p>
                </div>
                <div className="stat-card">
                    <h3>Automations</h3>
                    <p className="stat-value">{automations.length}</p>
                </div>
            </div>

            <div className="rooms-overview">
                <h3>Devices by Room</h3>
                {Object.keys(devicesByRoom).length > 0 ? (
                    Object.entries(devicesByRoom).map(([room, roomDevices]) => (
                        <div key={room} className="room-section">
                            <h4>{room} ({roomDevices.length} devices)</h4>
                            <div className="device-status-list">
                                {roomDevices.map(device => (
                                    <div key={device.id} className="status-item">
                                        <span>{device.name}</span>
                                        <span className="status-badge online">
                                            Ready
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="empty-state">
                        <p>No devices to display</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;