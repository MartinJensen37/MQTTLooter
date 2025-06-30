import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { toast } from 'react-toastify';
import MQTTService from '../services/MQTTService';
import { generateClientId } from '../utils/helpers';

const ConnectionContext = createContext();

const initialState = {
  connections: {},
  activeConnection: null,
  isLoading: false
};

function connectionReducer(state, action) {
  switch (action.type) {
    case 'SET_CONNECTIONS':
      return { ...state, connections: action.payload };
    
    case 'ADD_CONNECTION':
      return {
        ...state,
        connections: {
          ...state.connections,
          [action.payload.id]: action.payload
        }
      };
    
    case 'UPDATE_CONNECTION':
      return {
        ...state,
        connections: {
          ...state.connections,
          [action.payload.id]: action.payload
        }
      };
    
    case 'DELETE_CONNECTION':
      const newConnections = { ...state.connections };
      delete newConnections[action.payload];
      return {
        ...state,
        connections: newConnections,
        activeConnection: state.activeConnection?.id === action.payload ? null : state.activeConnection
      };
    
    case 'SET_ACTIVE_CONNECTION':
      return { ...state, activeConnection: action.payload };
    
    case 'SET_CONNECTION_STATUS':
      return {
        ...state,
        connections: {
          ...state.connections,
          [action.payload.id]: {
            ...state.connections[action.payload.id],
            ...action.payload.status
          }
        }
      };
    
    default:
      return state;
  }
}

export function ConnectionProvider({ children }) {
  const [state, dispatch] = useReducer(connectionReducer, initialState);

  // Load connections from localStorage on mount
  useEffect(() => {
    const savedConnections = localStorage.getItem('mqttConnections');
    if (savedConnections) {
      try {
        const connections = JSON.parse(savedConnections);
        dispatch({ type: 'SET_CONNECTIONS', payload: connections });
      } catch (error) {
        console.error('Error loading connections:', error);
      }
    }
  }, []);

  // Save connections to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(state.connections).length > 0) {
      const connectionsToSave = Object.values(state.connections).reduce((acc, conn) => {
        acc[conn.id] = {
          id: conn.id,
          name: conn.name,
          url: conn.url,
          clientId: conn.clientId,
          username: conn.username,
          password: conn.password,
          subscriptionTopics: conn.subscriptionTopics || ['#']
        };
        return acc;
      }, {});
      localStorage.setItem('mqttConnections', JSON.stringify(connectionsToSave));
    }
  }, [state.connections]);

  const addConnection = (connectionData) => {
    const id = Date.now().toString();
    const connection = {
      id,
      ...connectionData,
      clientId: connectionData.clientId || generateClientId(),
      subscriptionTopics: connectionData.subscriptionTopics || ['#'],
      connected: false,
      connecting: false,
      hasError: false,
      client: null
    };
    
    dispatch({ type: 'ADD_CONNECTION', payload: connection });
    toast.success(`Connection "${connection.name}" added successfully`);
  };

  const updateConnection = (id, connectionData) => {
    const existingConnection = state.connections[id];
    if (!existingConnection) return;

    // Disconnect if currently connected
    if (existingConnection.connected && existingConnection.client) {
      MQTTService.disconnect(id);
    }

    const updatedConnection = {
      ...existingConnection,
      ...connectionData,
      hasError: false
    };

    dispatch({ type: 'UPDATE_CONNECTION', payload: updatedConnection });
    toast.success(`Connection "${updatedConnection.name}" updated successfully`);
  };

  const deleteConnection = async (id) => {
    const connection = state.connections[id];
    if (!connection) return;

    if (connection.connected && connection.client) {
      await MQTTService.disconnect(id);
    }

    dispatch({ type: 'DELETE_CONNECTION', payload: id });
    toast.info('Connection deleted');
  };

  const connectToMqtt = async (id) => {
    const connection = state.connections[id];
    if (!connection || connection.connected) return;

    dispatch({ 
      type: 'SET_CONNECTION_STATUS', 
      payload: { id, status: { connecting: true, hasError: false } }
    });

    try {
      await MQTTService.connect(id, connection, {
        onConnected: () => {
          dispatch({ 
            type: 'SET_CONNECTION_STATUS', 
            payload: { id, status: { connected: true, connecting: false, hasError: false } }
          });
          if (!state.activeConnection) {
            setActiveConnection(connection);
          }
          toast.success(`Connected to ${connection.name}`);
        },
        onDisconnected: () => {
          dispatch({ 
            type: 'SET_CONNECTION_STATUS', 
            payload: { id, status: { connected: false, connecting: false } }
          });
          toast.info(`Disconnected from ${connection.name}`);
        },
        onError: (error) => {
          dispatch({ 
            type: 'SET_CONNECTION_STATUS', 
            payload: { id, status: { connected: false, connecting: false, hasError: true } }
          });
          toast.error(`Connection error: ${connection.name} - ${error.message}`);
        }
      });
    } catch (error) {
      dispatch({ 
        type: 'SET_CONNECTION_STATUS', 
        payload: { id, status: { connected: false, connecting: false, hasError: true } }
      });
      toast.error(`Failed to connect: ${error.message}`);
    }
  };

  const disconnectFromMqtt = async (id) => {
    try {
      await MQTTService.disconnect(id);
      dispatch({ 
        type: 'SET_CONNECTION_STATUS', 
        payload: { id, status: { connected: false, connecting: false } }
      });
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  };

  const setActiveConnection = (connection) => {
    dispatch({ type: 'SET_ACTIVE_CONNECTION', payload: connection });
  };

  const value = {
    ...state,
    addConnection,
    updateConnection,
    deleteConnection,
    connectToMqtt,
    disconnectFromMqtt,
    setActiveConnection
  };

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export const useConnections = () => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnections must be used within a ConnectionProvider');
  }
  return context;
};