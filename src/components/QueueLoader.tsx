import React from 'react';

interface QueueLoaderProps {
  small?: boolean;
}

const QueueLoader: React.FC<QueueLoaderProps> = ({ small }) => {
  return (
    <div className={`queue-loader-container ${small ? 'small' : ''}`}>
      <div className="queue-loader-wrapper">
        <div className="queue-person p1"></div>
        <div className="queue-person p2"></div>
        <div className="queue-person p3"></div>
      </div>
      {!small && <p className="queue-loader-text">Organizando a fila...</p>}

      <style>{`
        .queue-loader-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }

        .queue-loader-container.small {
          padding: 0;
          flex-direction: row;
        }

        .queue-loader-wrapper {
          display: flex;
          gap: 12px;
          margin-bottom: 1.5rem;
          height: 40px;
          align-items: flex-end;
        }

        .small .queue-loader-wrapper {
          gap: 6px;
          margin-bottom: 0;
          height: 20px;
        }

        .queue-person {
          width: 14px;
          height: 24px;
          background: var(--accent-primary, #D4AF37);
          border-radius: 4px 4px 2px 2px;
          position: relative;
          opacity: 0.3;
          box-shadow: 0 0 15px color-mix(in srgb, var(--accent-primary, #D4AF37) 30%, transparent);
        }

        .small .queue-person {
          width: 6px;
          height: 12px;
          box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary, #D4AF37) 30%, transparent);
        }

        .queue-person::after {
          content: '';
          position: absolute;
          top: -12px;
          left: 1px;
          width: 12px;
          height: 12px;
          background: inherit;
          border-radius: 50%;
        }

        .small .queue-person::after {
          top: -6px;
          left: 0px;
          width: 6px;
          height: 6px;
        }

        .p1 { animation: queueJump 1.2s infinite ease-in-out; }
        .p2 { animation: queueJump 1.2s infinite ease-in-out 0.2s; }
        .p3 { animation: queueJump 1.2s infinite ease-in-out 0.4s; }

        @keyframes queueJump {
          0%, 100% { 
            transform: translateY(0); 
            opacity: 0.3; 
            filter: blur(1px);
          }
          50% { 
            transform: translateY(-8px); 
            opacity: 1; 
            filter: blur(0);
            box-shadow: 0 5px 20px color-mix(in srgb, var(--accent-primary, #D4AF37) 60%, transparent);
          }
        }

        .small @keyframes queueJump {
          50% { transform: translateY(-4px); }
        }

        .queue-loader-text {
          color: var(--text-secondary);
          font-size: 0.9rem;
          font-weight: 500;
          letter-spacing: 0.5px;
          animation: pulseText 1.5s infinite ease-in-out;
        }

        @keyframes pulseText {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default QueueLoader;
