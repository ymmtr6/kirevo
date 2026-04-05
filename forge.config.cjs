module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.ymmtr6.kirevo",
    appCategoryType: "public.app-category.productivity",
    name: "Kirevo"
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"]
    }
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "ymmtr6",
          name: "kirevo"
        },
        prerelease: false,
        draft: false
      }
    }
  ]
};
