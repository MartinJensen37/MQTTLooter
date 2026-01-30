# MQTTLooter

An advanced MQTT client for exploring topics, analyzing message flows, and simulating IoT devices with a powerful graphical interface.

## Features

MQTTLooter is a comprehensive MQTT client designed for developers, IoT engineers, and system administrators who need to interact with MQTT brokers in sophisticated ways.

### Core MQTT Functionality
- Multi-connection management with simultaneous broker connections
- Full MQTT 3.1.1 and MQTT 5.0 protocol support
- TLS/SSL encryption with certificate management
- Username/password and client certificate authentication
- All QoS levels (0, 1, 2) with retained message support

### Topic Tree and Message Exploration
- Hierarchical topic visualization with automatic organization
- Real-time message rate statistics per topic
- Message history storage (up to 300 messages per topic)
- Topic search and filtering
- Export topic messages as JSON or CSV
- Expandable/collapsible tree navigation

### Message Publishing
- Manual message publishing with QoS and retain configuration
- Message template system with variable substitution
- Built-in templates for common IoT scenarios (weather stations, smart home devices, vehicle tracking)
- JSON schema validation for template payloads
- Template variables: `{{timestamp}}`, `{{randomFloat(min, max, precision)}}`, `{{randomInt(min, max)}}`, `{{randomChoice("a", "b")}}`, `{{uuid}}`
- Template import/export functionality
- Publishing history tracking

### Recording and Playback
- Record MQTT message sessions with full metadata
- Playback with variable speed control (0.5x - 4x)
- Step-by-step message navigation
- Topic filtering during playback
- Optional message re-publishing during playback
- Save/load recording sessions as JSON files
- Session renaming and organization

### Device Simulation
- Create virtual IoT devices with multiple data outputs
- Configurable publishing intervals per device
- Multiple data types: number, boolean, string, enum
- Data generation methods:
  - Static values
  - Uniform random distribution
  - Normal (Gaussian) distribution with mean and standard deviation
  - Sine wave patterns for periodic data
  - Exponential distribution
  - Pattern sequences with configurable intervals
  - Weighted random selection
  - List-based random selection
- Decimal precision control for numeric values
- Optional unit suffixes for measurements
- Timestamp inclusion per output
- Real-time value preview
- Batch device control (start/stop all)

### User Interface
- Resizable panel layout with persistent sizing
- Keyboard shortcuts: F1 (Topic Tree), F2 (Publishing), F3 (Recording), F4 (Simulation)
- Tabbed interface for different functionality panels
- Toast notifications for user feedback
- Connection sidebar with connection management
- Collapsible panels for workspace optimization

## Downloads and Releases

### Latest Release: v0.3.0

**Windows Installer**: `MQTTLooter Setup 0.3.0.exe`

Installer features:
- Desktop and start menu shortcuts
- Per-user installation (no administrator rights required)
- Clean uninstallation support
- Configurable installation directory

### Release Notes
- Enhanced device simulation with 8 different data generators
- Message template system with JSON schema validation
- Connection management improvements
- Recording and playback functionality
- Performance optimizations

## Technologies and Dependencies

### Core Framework
- **Electron** 36.5.0 - Desktop application framework
- **React** 18.2.0 - UI framework
- **Node.js** - JavaScript runtime

### MQTT Communication
- **mqtt** 5.13.1 - MQTT client library with full MQTT 5.0 support

### UI Components
- **@fortawesome/fontawesome-free** 6.7.2 - Icon library
- **react-split-pane** 0.1.92 - Resizable panel layouts
- **@emotion/react** & **@emotion/styled** 11.11.x - Component styling
- **lucide-react** 0.263.1 - Additional icons
- **react-toastify** 9.1.3 - Notification system

### Build Tools
- **electron-builder** 24.13.3 - Application packaging
- **concurrently** 7.6.0 - Parallel script execution
- **cross-env** 7.0.3 - Cross-platform environment variables
- **wait-on** 7.2.0 - Resource availability checking
- **react-scripts** 5.0.1 - React build configuration

### Security
- **@electron/fuses** 1.8.0 - Electron security hardening

## Architecture

```
MQTTLooter/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── index.js                   # Application entry point
│   │   ├── mqtt-connection-manager.js # MQTT connection handling
│   │   ├── menu.js                    # Application menu
│   │   └── ipc-handlers.js            # IPC communication
│   ├── preload/                       # Secure IPC bridge
│   ├── renderer/                      # React frontend
│   │   ├── src/
│   │   │   ├── components/            # React components
│   │   │   │   ├── App/
│   │   │   │   ├── ConnectionSidebar/
│   │   │   │   ├── TopicTree/
│   │   │   │   ├── MessagePanel/
│   │   │   │   ├── PublishingPanel/
│   │   │   │   ├── RecordingPanel/
│   │   │   │   └── SimulationPanel/
│   │   │   ├── services/              # Business logic
│   │   │   │   ├── MQTTService.js
│   │   │   │   ├── TopicTreeService.js
│   │   │   │   └── MessageTemplateService.js
│   │   │   └── styles/                # Global styles
│   │   └── build/                     # Production build
│   └── assets/                        # Application icons
├── package.json                       # Main dependencies
└── example-templates.json             # Template examples
```

## Functionality Guide

### Topic Tree View (F1)
The topic tree organizes MQTT topics hierarchically based on the `/` separator:

- Automatic tree structure generation from incoming messages
- Message count badges on each topic node
- Real-time message rate calculation (messages per second)
- Latest message value preview
- Click any topic to view its message history in the message panel
- Expand/collapse all buttons for navigation
- Clear tree function to reset all data
- Statistics bar showing total topics, messages, and overall message rate

### Message Publishing (F2)
Publish messages to MQTT topics with advanced template support:

**Basic Publishing:**
- Topic input with autocomplete from existing topics
- Payload editor with JSON validation
- QoS selection (0, 1, 2)
- Retain flag toggle
- Publishing history list

**Message Templates:**
Pre-configured templates for common scenarios:
- Weather station data (temperature, humidity, pressure, wind)
- Device status reports (online/offline, battery, firmware)
- GPS location tracking
- Smart home thermostat control
- Generic IoT sensor data

**Template System:**
- Create custom templates with JSON schema validation
- Variable substitution using double curly braces
- Function support: `{{timestamp}}`, `{{randomFloat(min, max, decimals)}}`, `{{randomInt(min, max)}}`, `{{randomChoice("a", "b", "c")}}`, `{{uuid}}`
- Template categories for organization
- Import/export templates as JSON
- Schema validation with detailed error reporting

### Recording and Playback (F3)
Record and analyze MQTT message flows:

**Recording:**
- Start/stop recording with single button
- Real-time message counter and duration display
- Automatic session naming with timestamp
- Records all message metadata (topic, payload, QoS, retain, timestamp)
- Connection information tracking

**Playback:**
- Load recorded sessions from list or file
- Playback speed control (0.5x, 1x, 1.5x, 2x, 3x, 4x)
- Play/pause/reset controls
- Step forward/backward through messages
- Configurable step size (1, 5, 10, 15, 20 messages)
- Current message details display
- Optional message re-publishing during playback
- Visual progress bar

**Session Management:**
- Save recordings to JSON files
- Rename sessions inline
- Delete unwanted recordings
- Load recordings from file system
- Session metadata includes start/end time, message count, unique topics

### Device Simulation (F4)
Create virtual IoT devices that publish realistic data:

**Device Configuration:**
- Device name and topic specification
- Multiple outputs per device
- Configurable publishing interval (100ms to 60s)
- Start/stop individual or all devices

**Output Configuration:**
Each device output can be configured with:
- Name and data type (number, boolean, string, enum)
- Unit suffix for numeric values (e.g., °C, W, %)
- Decimal precision (0-6 places)
- Optional timestamp inclusion
- Generator type selection

**Data Generators:**

*Number Generators:*
- Static: Fixed value
- Uniform: Random value between min and max
- Normal: Gaussian distribution with mean and standard deviation
- Sine: Periodic wave pattern with configurable frequency
- Exponential: Exponential distribution with lambda parameter

*Boolean Generators:*
- Static: Fixed true/false
- Probability: Random with configurable true probability
- Pattern: Sequence of true/false values with timing

*String/Enum Generators:*
- Static: Fixed string value
- List: Random selection from list of options
- Weighted: Random selection with weighted probabilities
- Pattern: Sequence rotation through values

**Real-time Features:**
- Live value preview in device configuration
- Current value display for each output
- Publishing status indicator
- Message payload preview
- Start/stop all devices functionality

### Connection Management
Sophisticated broker connection handling:

**Connection Configuration:**
- Broker URL (mqtt://, mqtts://, ws://, wss://)
- Custom client ID or auto-generation
- Username and password authentication
- Keep-alive interval
- Clean session configuration
- Connection timeout
- Reconnect settings
- Will message configuration

**MQTT 5.0 Features:**
- Session expiry interval
- Receive maximum
- Maximum packet size
- Topic alias maximum
- Request response information
- Request problem information
- User properties

**TLS/SSL Configuration:**
- Certificate file upload (CA, client cert, client key)
- Reject unauthorized option
- Certificate content preview

**Connection Profiles:**
- Save connection configurations
- Quick connect to saved brokers
- Connection rename and delete
- Active connection indicator
- Per-connection topic trees and message histories

## Use Cases

**IoT Development:**
- Test MQTT integrations before hardware availability
- Simulate sensor data for application development
- Debug message routing and topic hierarchies
- Validate QoS behavior and retained messages

**System Integration:**
- Analyze existing MQTT infrastructure
- Record production message patterns
- Test system behavior with recorded data
- Validate message schemas and formats

**Performance Testing:**
- Simulate multiple devices for load testing
- Generate high-frequency message streams
- Test broker capacity and latency
- Analyze message rate and throughput

**Education and Learning:**
- Understand MQTT protocol mechanics
- Experiment with QoS levels and behavior
- Learn topic organization patterns
- Explore retained message concepts

**Operations and Monitoring:**
- Monitor live MQTT traffic
- Troubleshoot connectivity issues
- Analyze message patterns and anomalies
- Export data for external analysis

## Building from Source

### Prerequisites
- Node.js 16 or higher
- npm package manager
- Git

### Build Instructions

```bash
# Clone the repository
git clone <repository-url>
cd MQTTLooter

# Install main dependencies
npm install

# Install renderer dependencies
cd src/renderer
npm install
cd ../..

# Build the React frontend
npm run build:renderer

# Create Windows installer
npm run dist
```

The installer will be created in the `dist-builder` directory as `MQTTLooter Setup 0.3.0.exe`.

### Development Mode

```bash
# Run in development mode with hot reload
npm run dev

# This starts both the React dev server and Electron
# The React app runs on http://localhost:3000
# Electron loads the dev server automatically

# Alternatively, run components separately:
npm run dev:renderer  # Start React development server
npm run dev:electron  # Start Electron pointing to dev server
```

### Build Configuration

The `package.json` contains electron-builder configuration for Windows NSIS installer:
- One-click installer option disabled for user control
- Desktop and start menu shortcuts
- Per-user installation directory
- Uninstaller creation
- Application compression set to maximum

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome. Please submit issues for bugs or feature requests, and pull requests for code contributions.

## Support

For support, bug reports, or feature requests, please visit the project repository or contact the development team.

---

**MQTTLooter** - Professional MQTT client for development, testing, and operations.