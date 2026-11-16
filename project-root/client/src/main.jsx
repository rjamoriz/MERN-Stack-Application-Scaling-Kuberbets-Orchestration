import React from 'react';
import { createRoot } from 'react-dom/client';
import SupervisedDemo from './components/SupervisedDemo.jsx';
import UnsupervisedDemo from './components/UnsupervisedDemo.jsx';
import RecommendationsDemo from './components/RecommendationsDemo.jsx';
import PredictiveTextDemo from './components/PredictiveTextDemo.jsx';
import SmartRecommendationsDemo from './components/SmartRecommendationsDemo.jsx';
import VoiceConversationDemo from './components/VoiceConversationDemo.jsx';
import CourseChat from './components/CourseChat.jsx';
import './styles.css';

function App() {
  return (
    <main>
      <header>
        <p className="eyebrow">MERN + AI / Interactive course lab</p>
        <h1>From predictions to adaptive interfaces</h1>
        <p>Explore predictions, discovery, personalization, and language interfaces. No invented accuracy claims.</p>
      </header>
      <SupervisedDemo />
      <UnsupervisedDemo />
      <RecommendationsDemo />
      <PredictiveTextDemo />
      <SmartRecommendationsDemo />
      <VoiceConversationDemo />
      <CourseChat />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
