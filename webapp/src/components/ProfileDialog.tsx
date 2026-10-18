import { Dialog, DialogTitle, DialogContent, IconButton, DialogActions, Button, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useUserLogout, useUserMe } from "../api/users.ts";

const ProfileDialog = ({ showDialog, setShowDialog }: { showDialog: boolean; setShowDialog: (show: boolean) => void }) => {
  const logout = useUserLogout();
  const me = useUserMe();

  return (
    <>
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="xs" fullWidth>
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
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          <Typography gutterBottom>Userame: {me.data?.username || "-"}</Typography>
          <Typography gutterBottom>Authority: {me.data?.authority.toString() ?? "-"}</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" loading={logout.isPending} onClick={() => logout.mutate()}>
            Logout
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ProfileDialog;
