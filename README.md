# MQTTLooter

An advanced MQTT client for exploring topics, analyzing message flows, and simulating IoT devices with a powerful graphical interface.

## 🚀 Features

MQTTLooter is a comprehensive MQTT client designed for developers, IoT engineers, and system administrators who need to interact with MQTT brokers in sophisticated ways.

### Core MQTT Functionality
- **Multi-connection Management**: Connect to multiple MQTT brokers simultaneously
- **Protocol Support**: Full MQTT 3.1.1 and MQTT 5.0 support
- **Secure Connections**: TLS/SSL support with certificate management
- **Authentication**: Username/password and certificate-based authentication
- **QoS Levels**: Support for all QoS levels (0, 1, 2)
- **Retained Messages**: Full retained message support

### 📊 Topic Tree & Message Exploration
- **Interactive Topic Tree**: Hierarchical visualization of all MQTT topics
- **Real-time Updates**: Live topic tree updates as messages arrive
- **Message History**: Store and browse message history for each topic
- **Search & Filter**: Advanced topic search and filtering capabilities
- **Statistics**: Real-time message rate and connection statistics
- **Expandable Tree**: Collapse/expand topic branches for better navigation

### ✉️ Message Publishing
- **Manual Publishing**: Send messages to any topic with custom QoS and retain settings
- **Message Templates**: Pre-built and custom message templates with variables
- **Template Categories**: Organized templates for IoT sensors, smart home, vehicle tracking, etc.
- **Schema Validation**: JSON schema validation for message templates
- **Variable Substitution**: Dynamic variable replacement with functions like `{{timestamp}}`, `{{randomFloat()}}`, etc.
- **Template Import/Export**: Share message templates across different installations

### 📹 Recording & Playback
- **Message Recording**: Record all incoming messages for later analysis
- **Session Management**: Save and load recording sessions
- **Playback Control**: Play back recorded sessions with speed control
- **Topic Filtering**: Filter playback by specific topics
- **Re-publishing**: Option to republish recorded messages during playback
- **Export/Import**: Save recordings as JSON files for sharing

### 🤖 Device Simulation
- **Virtual Devices**: Create simulated IoT devices that publish realistic data
- **Multiple Data Types**: Support for numbers, strings, booleans, and objects
- **Data Generators**: Various data generation methods:
  - Static values
  - Random ranges (uniform, normal distribution)
  - Sine waves for periodic data
  - Exponential distributions
  - Pattern sequences
  - Weighted random selections
- **Real-time Publishing**: Continuous data publishing with configurable intervals
- **Device Management**: Start/stop, configure, and monitor multiple simulated devices

### 🔧 Advanced Features
- **Keyboard Shortcuts**: Quick access with F1-F4 keys for different panels
- **Connection Profiles**: Save and reuse connection configurations
- **Data Persistence**: Automatic saving of connections, templates, and recordings
- **Multi-panel Interface**: Tabbed interface for different functionalities
- **Responsive Design**: Adaptive UI that works on different screen sizes
- **Theme Support**: Modern, clean interface with intuitive navigation

## 📥 Downloads & Releases

### Latest Release: v0.3.0

**Windows Installer**: MQTTLooter Setup 0.3.0.exe

The installer provides:
- Easy installation with desktop and start menu shortcuts
- Automatic updates support
- Clean uninstallation option
- Per-user installation (no admin rights required)

### Release Notes
- Enhanced device simulation with multiple data generators
- Improved message template system with schema validation
- Better connection management and statistics
- Recording and playback functionality
- Performance optimizations and bug fixes

## 🛠️ Technologies & Dependencies

### Core Framework
- **Electron** `36.5.0` - Cross-platform desktop application framework
- **React** `^18.2.0` - User interface framework
- **Node.js** - Backend JavaScript runtime

### MQTT & Communication
- **mqtt** `^5.13.1` - Full-featured MQTT client library with MQTT 5.0 support
- Supports WebSocket, TCP, and TLS connections
- Complete QoS and retained message handling

### UI & Styling
- **@fortawesome/fontawesome-free** `^6.7.2` - Icon library
- **react-split-pane** `^0.1.92` - Resizable panel layouts
- **@emotion/react** & **@emotion/styled** `^11.11.x` - CSS-in-JS styling
- **lucide-react** `^0.263.1` - Additional icon set
- **react-toastify** `^9.1.3` - Toast notifications

### Build & Development
- **electron-builder** `^24.13.3` - Application packaging and distribution
- **concurrently** `^7.6.0` - Run multiple commands simultaneously
- **cross-env** `^7.0.3` - Cross-platform environment variables
- **wait-on** `^7.2.0` - Wait for resources before starting
- **react-scripts** `5.0.1` - React build tools

### Security & Fuses
- **@electron/fuses** `^1.8.0` - Electron security configuration
- Hardened security settings for production builds

## 🏗️ Architecture

MQTTLooter follows a modern Electron architecture:

```
src/
├── main/           # Electron main process
│   ├── index.js    # Application entry point
│   ├── mqtt-connection-manager.js  # MQTT connection handling
│   ├── menu.js     # Application menu
│   └── ipc-handlers.js  # Inter-process communication
├── preload/        # Preload scripts for secure IPC
├── renderer/       # React frontend application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # Business logic services
│   │   └── styles/         # CSS styles
│   └── build/      # Production build output
└── assets/         # Application icons and resources
```

## 📋 Detailed Functionality Guide

### 🌳 Topic Tree View (F1)
The Topic Tree provides a hierarchical view of all MQTT topics:

- **Automatic Organization**: Topics are automatically organized in a tree structure based on the `/` separator
- **Message Counters**: Shows message count and latest values for each topic
- **Expandable Nodes**: Click to expand/collapse topic branches
- **Real-time Updates**: Tree updates automatically as new messages arrive
- **Search Functionality**: Find topics quickly with the search feature
- **Statistics Display**: Shows total topics, messages, and message rate

**Features:**
- Click any topic to view its message history
- Expand/collapse all buttons for quick navigation
- Clear tree function to reset the view
- Live statistics showing activity levels

### ✉️ Message Publishing (F2)
Advanced message publishing capabilities:

**Basic Publishing:**
- Enter topic, payload, QoS (0, 1, 2), and retain flag
- Support for JSON, plain text, and binary payloads
- Auto-formatting and validation for JSON messages
- Publish history tracking

**Message Templates:**
MQTTLooter includes a powerful template system with pre-built templates:

- **Weather Station**: Temperature, humidity, pressure data
- **Smart Home**: Thermostat, lighting, security sensors
- **Vehicle Tracking**: GPS coordinates, speed, fuel level
- **Device Status**: Online/offline status, battery levels
- **IoT Sensors**: Generic sensor data patterns

**Template Features:**
- **Variable Substitution**: Use `{{variableName}}` for dynamic values
- **Built-in Functions**: 
  - `{{timestamp}}` - Current Unix timestamp
  - `{{randomFloat(min, max, precision)}}` - Random decimal number
  - `{{randomInt(min, max)}}` - Random integer
  - `{{randomChoice("option1", "option2")}}` - Random selection
- **Schema Validation**: JSON schema validation for template payloads
- **Import/Export**: Share templates between installations
- **Custom Variables**: Define your own variables with default values

### 📹 Recording & Playback (F3)
Comprehensive message recording and analysis:

**Recording Features:**
- **Session Recording**: Record all incoming messages during a session
- **Topic Filtering**: Record only specific topics or patterns
- **Metadata Capture**: Timestamp, QoS, retain flag, and payload size
- **Real-time Statistics**: Message count, duration, unique topics

**Playback Features:**
- **Speed Control**: Play back at different speeds (0.5x to 4x)
- **Step-by-Step**: Manual step through recorded messages
- **Topic Filtering**: Play back only selected topics
- **Re-publishing**: Option to republish messages during playback
- **Visual Progress**: Timeline view of message flow

**Session Management:**
- Save recordings to JSON files
- Load previous recordings
- Rename and organize sessions
- Export recordings for analysis in other tools

### 🤖 Device Simulation (F4)
Create and manage virtual IoT devices:

**Device Creation:**
- **Device Profiles**: Create devices with custom names and topics
- **Multiple Outputs**: Each device can have multiple data outputs
- **Publishing Intervals**: Configure how often devices publish data

**Data Generation Types:**
- **Static Values**: Fixed values for testing
- **Random Ranges**: Uniform distribution between min/max values
- **Normal Distribution**: Gaussian distribution with mean and standard deviation
- **Sine Waves**: Periodic data for sensor simulation
- **Exponential**: Exponential distribution for event modeling
- **Pattern Sequences**: Repeat predefined value sequences
- **Weighted Random**: Random selection with custom probabilities
- **List Selection**: Random choice from predefined options

**Device Management:**
- **Real-time Control**: Start/stop individual devices or all at once
- **Live Preview**: See generated values before publishing
- **Configuration**: Easy editing of device parameters
- **Publishing Stats**: Monitor message publication rates

**Use Cases:**
- **Load Testing**: Generate high-volume message traffic
- **Sensor Simulation**: Realistic temperature, humidity, pressure data
- **Device Prototyping**: Test applications before hardware is ready
- **Data Pipeline Testing**: Validate data processing systems

### 🔗 Connection Management
Sophisticated connection handling:

**Connection Profiles:**
- Save frequently used broker configurations
- Support for multiple simultaneous connections
- Connection-specific topic trees and message history

**Security:**
- TLS/SSL encryption with certificate validation
- Client certificate authentication
- Username/password authentication
- Custom CA certificates

**MQTT 5.0 Features:**
- Enhanced authentication
- Message expiry intervals
- Topic aliases
- User properties
- Reason codes and detailed error information

## 🎯 Use Cases

**IoT Development:**
- Test MQTT message flows during development
- Simulate device behavior before hardware deployment
- Debug message routing and topic structures

**System Integration:**
- Analyze existing MQTT deployments
- Record and replay message patterns for testing
- Validate message schemas and data formats

**Education & Learning:**
- Understand MQTT protocol behavior
- Experiment with different QoS levels and configurations
- Learn about retained messages and topic structures

**Operations & Monitoring:**
- Monitor live MQTT traffic
- Debug connectivity issues
- Analyze message patterns and frequencies

## 🔧 Building from Source

### Prerequisites
- Node.js 16+ with npm
- Git

### Build Instructions
```bash
# Clone the repository
git clone <repository-url>
cd MQTTLooter

# Install dependencies
npm install

# Install renderer dependencies
cd src/renderer
npm install
cd ../..

# Build the renderer (React app)
npm run build:renderer

# Create installer
npm run dist
```

The installer will be created in the `dist-builder` directory.

### Development Mode
```bash
# Start development mode (hot reload)
npm run dev

# Or start components separately
npm run dev:renderer  # Start React dev server
npm run dev:electron  # Start Electron in development mode
```

## 📝 License

This project is licensed under the MIT License. See the license terms in the application or contact the developer for more information.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## 📞 Support

For support, bug reports, or feature requests, please visit the project repository or contact the development team.

---

**MQTTLooter** - Making MQTT exploration and testing intuitive and powerful.