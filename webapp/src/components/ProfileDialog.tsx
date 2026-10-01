import {
  Dialog,
  DialogTitle,
  DialogContent,
  Divider,
  IconButton,
  TextField,
  Alert,
  DialogActions,
  Button,
  Snackbar,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useProfile, useSaveProfile } from "../api/profile.ts";
import { useState, useEffect } from "react";

const ProfileDialog = ({
  showDialog,
  setShowDialog,
}: {
  showDialog: boolean;
  setShowDialog: (show: boolean) => void;
}) => {
  const { data: profileData, error: profileError, refetch } = useProfile();
  const {
    mutate: saveProfile,
    error: saveError,
    isPending: isSaving,
  } = useSaveProfile();
  const [newUsername, setNewUsername] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (showDialog) {
      refetch();
    }
  }, [showDialog, refetch]);

  useEffect(() => {
    if (profileData) {
      setNewUsername(profileData.username);
    }
  }, [profileData, showDialog]);

  function save() {
    saveProfile(
      { username: newUsername },
      {
        onSuccess: () => {
          setSuccess(true);
          setShowDialog(false);
        },
      },
    );
  }

  return (
    <>
      <Dialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        maxWidth="xs"
        fullWidth
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 1,
          }}
        >
          Profile{" "}
          <IconButton onClick={() => setShowDialog(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent>
          {profileError && (
            <Alert severity="error">{profileError.message}</Alert>
          )}
          {saveError && <Alert severity="error">{saveError.message}</Alert>}
          <TextField
            required
            fullWidth
            label="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)}>Cancel</Button>
          <Button loading={isSaving} variant="contained" type="submit">
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        open={success}
        autoHideDuration={6000}
        onClose={() => setSuccess(false)}
      >
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Profile saved successfully!
        </Alert>
      </Snackbar>
    </>
  );
};

export default ProfileDialog;
