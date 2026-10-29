import { useState } from "react";
import { Avatar } from "@mui/material";
import ProfileDialog from "../ProfileDialog.tsx";
import NavBarItem from "./NavBarItem.tsx";
import { useUserMe } from "../../api/users.ts";

const Profile = () => {
  const [showModal, setShowModal] = useState(false);
  const user = useUserMe();
  const username = user.data?.username ?? "";

  return (
    <>
      <NavBarItem
        title={user.isPending ? "Loading..." : username}
        onClick={() => setShowModal(true)}
        icon={
          <Avatar
            sx={{ width: 20, height: 20, fontSize: 11, fontWeight: 600, bgcolor: "primary.main", color: "primary.contrastText" }}
          >
            {username.charAt(0).toUpperCase()}
          </Avatar>
        }
      />

      <ProfileDialog showDialog={showModal} setShowDialog={setShowModal} />
    </>
  );
};

export default Profile;
