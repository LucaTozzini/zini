import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { useState } from "react";
import ProfileDialog from "../ProfileDialog.tsx";
import NavBarItem from "./NavBarItem.tsx";
import { useUserMe } from "../../api/users.ts";

const Profile = () => {
  const [showModal, setShowModal] = useState(false);
  const user = useUserMe();

  return (
    <>
      <NavBarItem
        title={user.isPending ? "Loading..." : user.data?.username || ""}
        handleClick={() => setShowModal(true)}
        Icon={AccountCircleIcon}
      />

      <ProfileDialog showDialog={showModal} setShowDialog={setShowModal} />
    </>
  );
};

export default Profile;
