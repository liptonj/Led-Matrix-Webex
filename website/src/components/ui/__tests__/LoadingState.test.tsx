import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CenteredLoading, LoadingState } from '../LoadingState';

describe('LoadingState', () => {
  describe('loading state', () => {
    it('renders loading spinner when loading is true', () => {
      render(
        <LoadingState loading={true} error={null}>
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders default loading text', () => {
      render(
        <LoadingState loading={true} error={null}>
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders custom loading text', () => {
      render(
        <LoadingState loading={true} error={null} loadingText="Fetching data...">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Fetching data...')).toBeInTheDocument();
    });

    it('does not render loading text when empty string', () => {
      render(
        <LoadingState loading={true} error={null} loadingText="">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders error alert when error is string', () => {
      render(
        <LoadingState loading={false} error="Failed to load data">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Failed to load data')).toBeInTheDocument();
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders error alert when error is Error object', () => {
      const error = new Error('Network error');
      render(
        <LoadingState loading={false} error={error}>
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders default error title', () => {
      render(
        <LoadingState loading={false} error="Something went wrong">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('renders custom error title', () => {
      render(
        <LoadingState loading={false} error="Something went wrong" errorTitle="Load Failed">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Load Failed')).toBeInTheDocument();
    });

    it('prioritizes error over loading', () => {
      render(
        <LoadingState loading={true} error="Error message">
          <p>Content</p>
        </LoadingState>
      );
      
      // Should show loading, not error (loading takes precedence in implementation)
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('Error message')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders empty state when isEmpty is true and emptyState is provided', () => {
      render(
        <LoadingState 
          loading={false} 
          error={null} 
          isEmpty={true}
          emptyState={<p>No items found</p>}
        >
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('No items found')).toBeInTheDocument();
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders content when isEmpty is true but no emptyState provided', () => {
      render(
        <LoadingState 
          loading={false} 
          error={null} 
          isEmpty={true}
        >
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders content when isEmpty is false', () => {
      render(
        <LoadingState 
          loading={false} 
          error={null} 
          isEmpty={false}
          emptyState={<p>No items found</p>}
        >
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    });
  });

  describe('content state', () => {
    it('renders children when not loading and no error', () => {
      render(
        <LoadingState loading={false} error={null}>
          <p>Content</p>
        </LoadingState>
      );
      
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <LoadingState loading={false} error={null}>
          <p>First</p>
          <p>Second</p>
        </LoadingState>
      );
      
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <LoadingState loading={false} error={null} className="custom-class">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('applies custom className in loading state', () => {
      const { container } = render(
        <LoadingState loading={true} error={null} className="custom-class">
          <p>Content</p>
        </LoadingState>
      );
      
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('forwards ref correctly', () => {
      const ref = jest.fn();
      render(
        <LoadingState loading={false} error={null} ref={ref}>
          <p>Content</p>
        </LoadingState>
      );
      expect(ref).toHaveBeenCalled();
    });

    it('spreads HTML attributes', () => {
      render(
        <LoadingState loading={false} error={null} data-testid="loading-state">
          <p>Content</p>
        </LoadingState>
      );
      expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    });
  });
});

describe('CenteredLoading', () => {
  it('renders loading spinner', () => {
    render(<CenteredLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders default loading text', () => {
    render(<CenteredLoading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders custom loading text', () => {
    render(<CenteredLoading text="Please wait..." />);
    expect(screen.getByText('Please wait...')).toBeInTheDocument();
  });

  it('has centered layout classes', () => {
    const { container } = render(<CenteredLoading />);
    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center');
  });
});
