import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
  }
  
  ha-card {
    padding-bottom: 16px;
    position: relative;
    overflow: hidden;
  }
  
  .card-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  
  .caller-info {
    width: 100%;
    text-align: center;
    margin-bottom: 24px;
  }
  
  .caller-info h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
  }
  
  .button-container {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    width: 100%;
  }
  
  ha-button {
    min-width: 110px;
    --mdc-theme-primary: var(--primary-color);
  }
  
  ha-button.answer {
    --mdc-theme-primary: var(--success-color, #4CAF50);
  }
  
  ha-button.hangup {
    --mdc-theme-primary: var(--error-color, #F44336);
  }
  
  ha-button.muted {
    --mdc-theme-primary: var(--warning-color, #FF9800);
  }
  
  .status-ringing {
    animation: pulse 1.5s infinite;
  }
  
  .status-active {
    border-left: 4px solid var(--success-color, #4CAF50);
  }
  
  @keyframes pulse {
    0% {
      border-left: 4px solid transparent;
    }
    50% {
      border-left: 4px solid var(--warning-color, #FF9800);
    }
    100% {
      border-left: 4px solid transparent;
    }
  }
  
  @media (max-width: 600px) {
    .button-container {
      flex-direction: column;
      align-items: stretch;
    }
    
    ha-button {
      width: 100%;
    }
  }
`;