import React from 'react';
import { Navbar, Nav, Container, /*Button,*/ NavDropdown } from 'react-bootstrap'; // Removed unused Button
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../utils/store';


const Navigation = () => {
  const { token, /*user,*/ clearToken } = useAuthStore(); // Removed unused user
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('token'); // Also clear from localStorage
    navigate('/'); // Navigate to home page after logout
  };

  return (
    <Navbar expand="lg" className="navbar-custom-bg"> {/* Use custom class */}
      <Container fluid className="content-in-fluid"> {/* Use fluid container with padding class */}
        <Navbar.Brand as={Link} to="/">LinguaRead</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/">Home</Nav.Link>
            {/* Navigation items are now always shown since login is automatic */}
            {/* We might still want to hide them briefly during initial loading in App.js, */}
            {/* but the logic here assumes token will be set quickly */}
            {token && ( // Keep token check for conditional rendering of user-specific links
              <>
                <NavDropdown title="Books" id="books-dropdown">
                  <NavDropdown.Item as={Link} to="/books">My Books</NavDropdown.Item>
                  <NavDropdown.Item as={Link} to="/books/create">Add New Book</NavDropdown.Item>
                </NavDropdown>

                <NavDropdown title="Texts" id="texts-dropdown">
                  <NavDropdown.Item as={Link} to="/texts">My Texts</NavDropdown.Item>
                  <NavDropdown.Item as={Link} to="/texts/create">Add Individual Text</NavDropdown.Item>
                  <NavDropdown.Item as={Link} to="/texts/create-audio">Add Audio Lesson</NavDropdown.Item>
                  <NavDropdown.Item as={Link} to="/texts/create-batch-audio">Add Batch Audio</NavDropdown.Item>
                </NavDropdown>

                <Nav.Link as={Link} to="/statistics">Statistics</Nav.Link>
                <Nav.Link as={Link} to="/terms">Terms</Nav.Link>
                <Nav.Link as={Link} to="/srs">SRS</Nav.Link>
              </>
            )}
          </Nav>

          <Nav>
            {/* Account dropdown is always shown if logged in (which should be always after load) */}
            {token && ( // Keep token check
              <NavDropdown title="Account" id="account-dropdown" align="end">
                <NavDropdown.Item as={Link} to="/settings">User Settings</NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/settings/languages">Languages</NavDropdown.Item>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={handleLogout}>Logout</NavDropdown.Item>
              </NavDropdown>
            )}
            {/* Removed the Login/Register links section */}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Navigation;