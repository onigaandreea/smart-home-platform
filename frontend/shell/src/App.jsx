import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost/ws';

// Debug: show which API/WS endpoints are used at runtime
console.log('Runtime endpoints:', { API_URL, WS_URL });

function App() {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [currentView, setCurrentView] = useState('devices');
    const [notifications, setNotifications] = useState([]);
    const wsRef = useRef(null);

    // WebSocket connection for real-time notifications
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

                setNotifications(prev => [notification, ...prev].slice(0, 10));

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
            alert('Login failed');
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
            alert('Registration failed');
        }
    };

    const handleLogout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('token');
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    };

    if (!user) {
        return <AuthForm onLogin={handleLogin} onRegister={handleRegister} />;
    }

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <h1>🏠 Smart Home</h1>
                </div>
                <div className="user-info">
                    <span>Welcome, {user.name}</span>
                    <button onClick={handleLogout} className="btn-logout">Logout</button>
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

            {notifications.length > 0 && (
                <div className="notifications">
                    <h3>🔔 Recent Alerts</h3>
                    {notifications.map((notif, idx) => (
                        <div key={idx} className={`notification ${notif.type}`}>
                            <span className="notification-type">{getNotificationIcon(notif.type)}</span>
                            <span className="notification-message">{notif.message}</span>
                        </div>
                    ))}
                </div>
            )}

            <main className="main-content">
                {currentView === 'devices' && <DevicesMFE token={token} />}
                {currentView === 'automations' && <AutomationsMFE token={token} />}
                {currentView === 'dashboard' && <DashboardMFE token={token} />}
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
        'device.offline': '⚠️'
    };
    return icons[type] || '🔔';
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
            <div className="auth-form">
                <h2>🏠 Smart Home</h2>
                <h3>{isLogin ? 'Login' : 'Register'}</h3>
                <form onSubmit={handleSubmit}>
                    {!isLogin && (
                        <input
                            type="text"
                            placeholder="Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <button type="submit" className="btn-primary">
                        {isLogin ? 'Login' : 'Register'}
                    </button>
                </form>
                <p>
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button onClick={() => setIsLogin(!isLogin)} className="btn-link">
                        {isLogin ? 'Register' : 'Login'}
                    </button>
                </p>
            </div>
        </div>
    );
}

// Devices Micro Frontend
function DevicesMFE({ token }) {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoom, setSelectedRoom] = useState('All');

    useEffect(() => {
        loadDevices();
    }, [token]);

    const loadDevices = () => {
        fetch(`${API_URL}/api/devices`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
            .then(res => res.json())
            .then(data => {
                setDevices(data.devices || []);
                setLoading(false);
            })
            .catch(console.error);
    };

    const toggleDevice = async (device) => {
        const newState = { ...device.state };

        // Toggle based on device type
        if (device.type === 'light') {
            newState.on = !newState.on;
        } else if (device.type === 'lock') {
            newState.locked = !newState.locked;
        } else if (device.type === 'camera') {
            newState.recording = !newState.recording;
        } else if (device.type === 'sprinkler') {
            newState.active = !newState.active;
        }

        try {
            await fetch(`${API_URL}/api/devices/${device.id}/state`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ state: newState })
            });

            loadDevices();
        } catch (error) {
            console.error('Toggle device error:', error);
        }
    };

    const rooms = ['All', ...new Set(devices.map(d => d.room).filter(Boolean))];
    const filteredDevices = selectedRoom === 'All'
        ? devices
        : devices.filter(d => d.room === selectedRoom);

    if (loading) return <div className="loading">Loading devices...</div>;

    return (
        <div className="devices">
            <div className="devices-header">
                <h2>My Devices</h2>
                <div className="room-filter">
                    {rooms.map(room => (
                        <button
                            key={room}
                            className={selectedRoom === room ? 'active' : ''}
                            onClick={() => setSelectedRoom(room)}
                        >
                            {room}
                        </button>
                    ))}
                </div>
            </div>

            <div className="device-grid">
                {filteredDevices.map(device => (
                    <DeviceCard key={device.id} device={device} onToggle={toggleDevice} />
                ))}
            </div>
        </div>
    );
}

function DeviceCard({ device, onToggle }) {
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
        return device.status;
    };

    const isActive = () => {
        return device.state.on || device.state.recording || device.state.active || !device.state.locked;
    };

    return (
        <div className={`device-card ${isActive() ? 'active' : ''}`}>
            <div className="device-icon">{getDeviceIcon(device.type)}</div>
            <div className="device-info">
                <h3>{device.name}</h3>
                <p className="device-room">{device.room}</p>
                <p className={`device-status ${device.status}`}>
                    {device.status === 'online' ? '🟢' : '🔴'} {device.status}
                </p>
            </div>
            <div className="device-controls">
                <span className="device-state">{getDeviceState()}</span>
                <button
                    className="btn-toggle"
                    onClick={() => onToggle(device)}
                    disabled={device.status !== 'online'}
                >
                    Toggle
                </button>
            </div>
        </div>
    );
}

// Automations Micro Frontend
function AutomationsMFE({ token }) {
    const [automations, setAutomations] = useState([]);
    const [showForm, setShowForm] = useState(false);

    useEffect(() => {
        loadAutomations();
    }, [token]);

    const loadAutomations = () => {
        fetch(`${API_URL}/api/automations`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
            .then(res => res.json())
            .then(data => setAutomations(data.automations || []))
            .catch(console.error);
    };

    const executeAutomation = async (id) => {
        try {
            await fetch(`${API_URL}/api/automations/${id}/execute`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            alert('Automation executed!');
            loadAutomations();
        } catch (error) {
            console.error('Execute error:', error);
        }
    };

    return (
        <div className="automations">
            <div className="automations-header">
                <h2>Automations</h2>
                <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
                    {showForm ? 'Cancel' : '+ New Automation'}
                </button>
            </div>

            {showForm && <AutomationForm token={token} onSave={() => { loadAutomations(); setShowForm(false); }} />}

            <div className="automation-list">
                {automations.map(auto => (
                    <div key={auto._id} className="automation-card">
                        <div className="automation-header">
                            <h3>{auto.name}</h3>
                            <span className={`badge ${auto.enabled ? 'enabled' : 'disabled'}`}>
                                {auto.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        <p className="automation-trigger">
                            Trigger: {auto.trigger.type}
                        </p>
                        <p className="automation-actions">
                            Actions: {auto.actions.length} device(s)
                        </p>
                        {auto.lastExecuted && (
                            <p className="automation-last">
                                Last: {new Date(auto.lastExecuted).toLocaleString()}
                            </p>
                        )}
                        <button
                            className="btn-execute"
                            onClick={() => executeAutomation(auto._id)}
                        >
                            ▶ Execute Now
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AutomationForm({ token, onSave }) {
    const [name, setName] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            await fetch(`${API_URL}/api/automations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name,
                    trigger: { type: 'time', conditions: {} },
                    actions: []
                })
            });

            onSave();
        } catch (error) {
            console.error('Create automation error:', error);
        }
    };

    return (
        <form className="automation-form" onSubmit={handleSubmit}>
            <input
                type="text"
                placeholder="Automation name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
            />
            <button type="submit" className="btn-primary">Create</button>
        </form>
    );
}

// Dashboard Micro Frontend
function DashboardMFE({ token }) {
    const [devices, setDevices] = useState([]);

    useEffect(() => {
        fetch(`${API_URL}/api/devices`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
            .then(res => res.json())
            .then(data => setDevices(data.devices || []))
            .catch(console.error);
    }, [token]);

    const stats = {
        total: devices.length,
        online: devices.filter(d => d.status === 'online').length,
        offline: devices.filter(d => d.status === 'offline').length,
        active: devices.filter(d => d.state.on || d.state.active || d.state.recording).length
    };

    return (
        <div className="dashboard">
            <h2>Dashboard</h2>

            <div className="stats-grid">
                <div className="stat-card">
                    <h3>Total Devices</h3>
                    <p className="stat-value">{stats.total}</p>
                </div>
                <div className="stat-card online">
                    <h3>Online</h3>
                    <p className="stat-value">{stats.online}</p>
                </div>
                <div className="stat-card offline">
                    <h3>Offline</h3>
                    <p className="stat-value">{stats.offline}</p>
                </div>
                <div className="stat-card active">
                    <h3>Active</h3>
                    <p className="stat-value">{stats.active}</p>
                </div>
            </div>

            <div className="device-status-list">
                <h3>Device Status</h3>
                {devices.map(device => (
                    <div key={device.id} className="status-item">
                        <span>{device.name}</span>
                        <span className={`status-badge ${device.status}`}>
                            {device.status}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default App;