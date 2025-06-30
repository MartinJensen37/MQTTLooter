import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { useConnections } from './useConnections';
import DatabaseService from '../services/DatabaseService';
import MQTTService from '../services/MQTTService';

const TopicContext = createContext();

const initialState = {
  topics: {},
  messageCounts: {},
  messageRates: {},
  selectedTopic: null,
  treeStructure: {},
  messages: [],
  loading: false
};

function topicReducer(state, action) {
  switch (action.type) {
    case 'ADD_MESSAGE':
      const { connectionId, topic, message, timestamp } = action.payload;
      const topicKey = `${connectionId}:${topic}`;
      
      return {
        ...state,
        messageCounts: {
          ...state.messageCounts,
          [topicKey]: (state.messageCounts[topicKey] || 0) + 1
        }
      };
    
    case 'UPDATE_MESSAGE_RATE':
      return {
        ...state,
        messageRates: {
          ...state.messageRates,
          [action.payload.topicKey]: action.payload.rate
        }
      };
    
    case 'SET_SELECTED_TOPIC':
      return { ...state, selectedTopic: action.payload };
    
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload, loading: false };
    
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    
    case 'UPDATE_TREE_STRUCTURE':
      return {
        ...state,
        treeStructure: {
          ...state.treeStructure,
          [action.payload.connectionId]: action.payload.structure
        }
      };
    
    case 'CLEAR_CONNECTION_DATA':
      const newState = { ...state };
      const connId = action.payload;
      
      // Clear message counts
      Object.keys(newState.messageCounts).forEach(key => {
        if (key.startsWith(`${connId}:`)) {
          delete newState.messageCounts[key];
        }
      });
      
      // Clear message rates
      Object.keys(newState.messageRates).forEach(key => {
        if (key.startsWith(`${connId}:`)) {
          delete newState.messageRates[key];
        }
      });
      
      // Clear tree structure
      delete newState.treeStructure[connId];
      
      return newState;
    
    default:
      return state;
  }
}

export function TopicProvider({ children }) {
  const [state, dispatch] = useReducer(topicReducer, initialState);
  const { activeConnection } = useConnections();

  // Subscribe to MQTT messages
  useEffect(() => {
    const handleMessage = async (connectionId, topic, message) => {
      // Store in database
      await DatabaseService.addMessage(connectionId, topic, message);
      
      // Update state
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { connectionId, topic, message, timestamp: Date.now() }
      });
      
      // Update tree structure
      updateTreeStructure(connectionId, topic, message);
    };

    MQTTService.onMessage(handleMessage);
    
    return () => {
      MQTTService.offMessage(handleMessage);
    };
  }, []);

  // Load messages when topic is selected
  useEffect(() => {
    if (state.selectedTopic && activeConnection) {
      loadMessages();
    }
  }, [state.selectedTopic, activeConnection]);

  const updateTreeStructure = (connectionId, topic, message) => {
    const parts = topic.split('/');
    const currentStructure = state.treeStructure[connectionId] || {};
    
    // Build tree structure logic (simplified version)
    let current = currentStructure;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {
          children: {},
          isExpanded: i === 0, // Auto-expand first level
          fullTopic: i === parts.length - 1 ? topic : null,
          lastMessage: null,
          messageCount: 0
        };
      }
      
      if (i === parts.length - 1) {
        current[part].lastMessage = message;
        current[part].fullTopic = topic;
      }
      
      current = current[part].children;
    }
    
    dispatch({
      type: 'UPDATE_TREE_STRUCTURE',
      payload: { connectionId, structure: currentStructure }
    });
  };

  const loadMessages = async () => {
    if (!state.selectedTopic || !activeConnection) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    
    try {
      const messages = await DatabaseService.getTopicMessages(
        activeConnection.id, 
        state.selectedTopic, 
        100, 
        0
      );
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    } catch (error) {
      console.error('Error loading messages:', error);
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const selectTopic = (topic) => {
    dispatch({ type: 'SET_SELECTED_TOPIC', payload: topic });
  };

  const clearConnectionData = (connectionId) => {
    dispatch({ type: 'CLEAR_CONNECTION_DATA', payload: connectionId });
  };

  const getTopicMessages = async (connectionId, topic, limit = 100, offset = 0) => {
    return await DatabaseService.getTopicMessages(connectionId, topic, limit, offset);
  };

  const value = {
    ...state,
    selectTopic,
    clearConnectionData,
    getTopicMessages,
    loadMessages,
    activeTreeStructure: activeConnection ? state.treeStructure[activeConnection.id] : null
  };

  return (
    <TopicContext.Provider value={value}>
      {children}
    </TopicContext.Provider>
  );
}

export const useTopics = () => {
  const context = useContext(TopicContext);
  if (!context) {
    throw new Error('useTopics must be used within a TopicProvider');
  }
  return context;
};