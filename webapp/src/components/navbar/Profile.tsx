import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { useState } from "react";
import ProfileDialog from "../ProfileDialog.tsx";
import { useProfile } from "../../api/profile.ts";
import NavBarItem from "./NavBarItem.tsx";

const Profile = () => {
  const [showModal, setShowModal] = useState(false);
  const { data: profile, isPending } = useProfile();

  return (
    <>
      <NavBarItem
        title={isPending ? "Loading..." : profile?.username || ""}
        handleClick={() => setShowModal(true)}
        Icon={AccountCircleIcon}
      />

      <ProfileDialog showDialog={showModal} setShowDialog={setShowModal} />
    </>
  );
};

export default Profile;
