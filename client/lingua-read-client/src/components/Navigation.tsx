import React from 'react';
import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { LinkContainer } from 'react-router-bootstrap';
import { useAuthStore } from '../utils/store';


const Navigation = () => {
  const { isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Navbar expand="lg" className="navbar-custom-bg">
      <Container fluid className="content-in-fluid">
        <LinkContainer to="/"><Navbar.Brand>LinguaRead</Navbar.Brand></LinkContainer>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <LinkContainer to="/"><Nav.Link>Home</Nav.Link></LinkContainer>
            {isAuthenticated && (
              <>
                <LinkContainer to="/library"><Nav.Link>Library</Nav.Link></LinkContainer>

                <NavDropdown title="Add" id="add-content-dropdown">
                  <LinkContainer to="/books/create"><NavDropdown.Item>Add Book</NavDropdown.Item></LinkContainer>
                  <LinkContainer to="/texts/create"><NavDropdown.Item>Add Text</NavDropdown.Item></LinkContainer>
                  <LinkContainer to="/texts/create-audio"><NavDropdown.Item>Add Audio Lesson</NavDropdown.Item></LinkContainer>
                  <LinkContainer to="/texts/create-batch-audio"><NavDropdown.Item>Batch Audio</NavDropdown.Item></LinkContainer>
                </NavDropdown>

                <LinkContainer to="/dashboard"><Nav.Link>Dashboard</Nav.Link></LinkContainer>
                <LinkContainer to="/statistics"><Nav.Link>Statistics</Nav.Link></LinkContainer>
                <LinkContainer to="/terms"><Nav.Link>Terms</Nav.Link></LinkContainer>
                <NavDropdown title="SRS" id="srs-dropdown">
                  <LinkContainer to="/srs"><NavDropdown.Item>Card Review</NavDropdown.Item></LinkContainer>
                  <LinkContainer to="/srs/story"><NavDropdown.Item>Story Review</NavDropdown.Item></LinkContainer>
                </NavDropdown>
              </>
            )}
          </Nav>

          <Nav>
            {isAuthenticated && (
              <NavDropdown title="Account" id="account-dropdown" align="end">
                <LinkContainer to="/settings"><NavDropdown.Item>User Settings</NavDropdown.Item></LinkContainer>
                <LinkContainer to="/settings/languages"><NavDropdown.Item>Languages</NavDropdown.Item></LinkContainer>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={handleLogout}>Logout</NavDropdown.Item>
              </NavDropdown>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Navigation;
